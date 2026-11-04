import { createHash, randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SummaryPointView } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, withPerson, type Database } from "@meet-first/db";
import { createTestPerson, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { LimiterBusy, type LiveCaller } from "@meet-first/llm";
import { normQuote } from "@meet-first/receipts";
import type { JobContext } from "../job-context.js";
import { makeTestJobContext, runJobOnce } from "../testing/index.js";

let fresh: TestDatabase;
let workerDb: Kysely<Database>;

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});
afterAll(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// A fake model that answers every names call with these names, or fails every call when there are none to give.
function namesModel(names: Array<{ text: string; role: string }> | "fails"): LiveCaller {
  return () => {
    if (names === "fails") return Promise.reject(new Error("the model is down"));
    const content = JSON.stringify({ names });
    return Promise.resolve({
      response: {
        id: "test",
        object: "chat.completion",
        model: "muse-spark-1.3",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      },
      usage: { promptTokens: 10, cachedTokens: 0, completionTokens: 10, reasoningTokens: 0 },
      requestId: null,
      httpStatus: 200,
    });
  };
}

// A person with a summary in checking state with this text and, when there are messages, one frozen source holding them in order.
async function seedPerson(
  name: string,
  input: { messages: readonly string[]; summary: string },
): Promise<string> {
  const { personId } = await createTestPerson(fresh.db, name);
  await withPerson(fresh.db, personId, async (trx) => {
    if (input.messages.length > 0) {
      const source = await trx
        .insertInto("sources")
        .values({
          person_id: personId,
          kind: "paste",
          content_hash: createHash("sha256").update(randomUUID()).digest(),
          turn_count: input.messages.length,
          canonical_chars: input.messages.join("").length,
          persona_signal: "0.500",
          parser_version: "1",
          scrub_version: "1",
          attested_at: new Date(),
          frozen_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("turns")
        .values(
          input.messages.map((text, index) => ({
            source_id: source.id,
            person_id: personId,
            turn_index: index,
            role: "user" as const,
            text,
            norm_text: normQuote(text),
          })),
        )
        .execute();
    }
    await trx
      .insertInto("person_summaries")
      .values({ person_id: personId, text: input.summary })
      .execute();
  });
  return personId;
}

// The summary as the job left it: its text, its state and its points.
async function summaryOf(
  personId: string,
): Promise<{ text: string; state: string; points: SummaryPointView[] }> {
  const row = await withPerson(fresh.db, personId, (trx) =>
    trx
      .selectFrom("person_summaries")
      .select(["text", "state", "points"])
      .where("person_id", "=", personId)
      .executeTakeFirstOrThrow(),
  );
  return { text: row.text, state: row.state, points: SummaryPointView.array().parse(row.points) };
}

// Runs check_summary once for the person, with the fake model.
async function check(personId: string, live: LiveCaller): Promise<void> {
  const { context } = makeTestJobContext({ db: workerDb, live });
  await runJobOnce(context, "check_summary", { personId });
}

describe("the check_summary job", () => {
  it("W7-SUMMARY-JOB-T1: names in the summary become role tokens, except the person's own name", async () => {
    const summary = [
      "Kind: work",
      "Topic: Rentably",
      "Point: Summary Founder built Rentably with Leon Hartley.",
      "Strength: strong",
    ].join("\n");
    const personId = await seedPerson("Summary Founder", { messages: [], summary });

    await check(
      personId,
      namesModel([
        { text: "Leon Hartley", role: "cofounder" },
        { text: "Summary Founder", role: "self" },
      ]),
    );
    const after = await summaryOf(personId);

    expect(after.state).toBe("ready");
    expect(after.text).not.toContain("Leon Hartley");
    expect(after.text).toContain("cofounder");
    expect(after.text).toContain("Summary Founder");
    expect(after.points.map((point) => point.point)[0]).not.toContain("Leon");
  });

  it("W7-SUMMARY-JOB-T2: a point whose quote is in a stored message, with other case and curly quotes, is found with that message's index", async () => {
    const summary = [
      "Kind: view",
      "Topic: Rentably",
      "Point: Rentably was never a bad idea.",
      "Strength: strong",
      "Quote: “rentably was NEVER a bad idea, the timing was just early”",
    ].join("\n");
    const personId = await seedPerson("Summary Quoter", {
      messages: [
        "I had pasta for lunch today, nothing special.",
        "Rentably was never a bad idea, the timing was just early.",
      ],
      summary,
    });

    await check(personId, namesModel([]));
    const [point] = (await summaryOf(personId)).points;

    expect(point?.found).toMatchObject({
      quote: "Rentably was never a bad idea, the timing was just early.",
      turnIndex: 1,
    });
  });

  it("W7-SUMMARY-JOB-T8: a quote that names someone is found in the message that holds that person's own role token, as the message has it", async () => {
    const summary = [
      "Kind: avoid",
      "Topic: Cofounder",
      "Point: Will not work with a past cofounder again.",
      "Strength: strong",
      "Quote: I will never work with Leon again",
    ].join("\n");
    const personId = await seedPerson("Summary Names", {
      messages: [
        "I had pasta for lunch today, nothing special.",
        "honestly I will never work with [person:co-founder] again, it was a mess",
      ],
      summary,
    });

    await check(personId, namesModel([{ text: "Leon", role: "cofounder" }]));
    const [point] = (await summaryOf(personId)).points;

    expect(point?.found).toMatchObject({
      quote: "I will never work with [person:co-founder] again",
      turnIndex: 1,
    });
  });

  it("W7-SUMMARY-JOB-T3: a quote in no stored message, or under 20 characters, leaves the point not found", async () => {
    const summary = [
      [
        "Kind: view",
        "Point: Likes long walks.",
        "Quote: i walk ten kilometres every single morning",
      ].join("\n"),
      ["Kind: habit", "Point: Eats lunch.", "Quote: had pasta"].join("\n"),
    ].join("\n\n");
    const personId = await seedPerson("Summary Missing", {
      messages: ["I had pasta for lunch today, nothing special."],
      summary,
    });

    await check(personId, namesModel([]));

    expect((await summaryOf(personId)).points.map((point) => point.found)).toEqual([null, null]);
  });

  it("W7-SUMMARY-JOB-T5: a summary that grows past 20,000 characters when names become role tokens is cut without splitting a token", async () => {
    const personId = await seedPerson("Summary Grows", {
      messages: [],
      summary: `Kind: view\nPoint: abc ${"Al and ".repeat(2_500)}`,
    });

    await check(personId, namesModel([{ text: "Al", role: "cofounder" }]));
    const after = await summaryOf(personId);

    expect(after.state).toBe("ready");
    expect(after.text.length).toBeLessThanOrEqual(20_000);
    expect(after.text).not.toMatch(/\[person:[^\]]*$/);
  });

  it("W7-SUMMARY-JOB-T4: a names call that fails every attempt leaves the summary failed and stores no points", async () => {
    const personId = await seedPerson("Summary Failed", {
      messages: [],
      summary: ["Kind: view", "Point: Rentably was never a bad idea."].join("\n"),
    });

    await check(personId, namesModel("fails"));
    const after = await summaryOf(personId);

    expect(after.state).toBe("failed");
    expect(after.points).toEqual([]);
  });

  it("W7-SUMMARY-JOB-T7: the names call shows each block of the summary as a labelled message, as the names prompt expects", async () => {
    const personId = await seedPerson("Summary Labels", {
      messages: [],
      summary: [
        "Kind: view",
        "Point: Rentably was never a bad idea.",
        "",
        "Kind: habit",
        "Point: Writes before checking messages.",
      ].join("\n"),
    });
    const seen: string[] = [];
    const names = namesModel([]);
    const capturing: LiveCaller = (request, signal) => {
      const messages = request.body.messages as Array<{ role: string; content: string }>;
      seen.push(messages.find((message) => message.role === "user")?.content ?? "");
      return names(request, signal);
    };

    await check(personId, capturing);

    expect(seen[0]).toContain(
      "<source_turns>\n[t:0] Kind: view\nPoint: Rentably was never a bad idea.\n\n[t:1] Kind: habit\nPoint: Writes before checking messages.\n</source_turns>",
    );
  });

  it("W7-SUMMARY-JOB-T6: a full token window leaves the summary checking and hands the job back to run again", async () => {
    const personId = await seedPerson("Summary Busy", {
      messages: [],
      summary: ["Kind: view", "Point: Rentably was never a bad idea."].join("\n"),
    });
    const { context } = makeTestJobContext({ db: workerDb });
    const busy: JobContext = {
      ...context,
      llm: { ...context.llm, complete: () => Promise.reject(new LimiterBusy(Date.now() + 5_000)) },
    };

    await expect(runJobOnce(busy, "check_summary", { personId })).rejects.toBeInstanceOf(
      LimiterBusy,
    );
    expect((await summaryOf(personId)).state).toBe("checking");
  });
});
