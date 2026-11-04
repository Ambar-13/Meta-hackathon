import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { BriefPoint, JOB_MAX_ATTEMPTS, type BriefSupportJudgeOutput } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, withMeeting, type Database } from "@meet-first/db";
import {
  freshTestDatabase,
  SEED_TURNS_B,
  type SeededMeeting,
  type TestDatabase,
} from "@meet-first/db/testing";
import { CHAT_MODEL, LimiterBusy, makeLlmClient, type LlmClient } from "@meet-first/llm";
import { makeReplayFolder, SCRIPTED_REPLIES_DIR, testWorkerEnv } from "@meet-first/llm/testing";
import { readPrompt } from "@meet-first/prompts";
import { definePayloadTask } from "../job-context.js";
import { makeTestJobContext } from "../testing/index.js";
import { seedBriefMeeting } from "./testing/golden-path-briefs.js";
import { writeBriefsTask } from "./write-briefs-job.js";

// The time every job in this file runs at, fixed so the fake clock is the same on every run.
const NOW = new Date("2026-10-26T12:00:00.000Z");
// The first note turn of side b: a quote only side b's judge call carries.
const SIDE_B_FIRST_QUOTE = SEED_TURNS_B[0];
// The row of a brief as the test reads it.
const BriefRow = z.object({
  person_id: z.string(),
  agree: z.array(BriefPoint),
  clash: z.array(BriefPoint),
  decide_first: z.array(BriefPoint),
  model: z.string(),
  prompt_version: z.string(),
  support_rate: z.union([z.string(), z.number()]).nullable(),
  support_reliable: z.boolean().nullable(),
  support_raw: z.record(z.unknown()).nullable(),
});

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
beforeEach(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});
afterEach(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// Seeds an ended meeting, or a running one when end is false.
function seed(end: boolean): Promise<SeededMeeting> {
  return seedBriefMeeting({ appDb: fresh.db, workerDb, end });
}

// The brief rows of one meeting, read in its context.
async function briefRows(meetingId: string): Promise<z.infer<typeof BriefRow>[]> {
  const rows = await withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("briefs")
      .selectAll()
      .where("meeting_id", "=", meetingId)
      .orderBy("created_at", "asc")
      .execute(),
  );
  return rows.map((row) => BriefRow.parse(row));
}

// The ledger rows of one meeting for one call site, read in the meeting's context.
function ledgerRows(meetingId: string, callSite: string) {
  return withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("ledger")
      .select(["call_site", "model", "status"])
      .where("meeting_id", "=", meetingId)
      .where("call_site", "=", callSite)
      .execute(),
  );
}

// The brief row of one person, which the test expects to exist.
function briefOf(
  rows: Array<z.infer<typeof BriefRow>>,
  personId: string,
): z.infer<typeof BriefRow> {
  const row = rows.find((candidate) => candidate.person_id === personId);
  if (row === undefined) throw new Error(`no brief row for ${personId}`);
  return row;
}

// The ready events of one meeting, with their payloads and sequence numbers.
function readyEvents(meetingId: string) {
  return withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("meeting_events")
      .select(["seq", "payload"])
      .where("meeting_id", "=", meetingId)
      .where("type", "=", "brief.ready")
      .execute(),
  );
}

// Whether a judge call is the one for side b, read from the side b quote it carries.
function isSideBJudge(args: {
  callSite: string;
  messages: Array<{ content: string | null }>;
}): boolean {
  return (
    args.callSite === "brief_support_judge" &&
    (args.messages[1]?.content ?? "").includes(`<quote>"${SIDE_B_FIRST_QUOTE}"</quote>`)
  );
}

// A replay client over the scripted replies, or over a given fixture folder.
function replayClient(fixtureRoot = SCRIPTED_REPLIES_DIR): LlmClient {
  return makeLlmClient({
    db: workerDb,
    env: testWorkerEnv("replay"),
    now: () => NOW,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    fixtureRoot,
  });
}

// The judge verdicts of one brief with one line changed: index 6 unsupported, index 0 supported.
function judgeWithIndexSix(): BriefSupportJudgeOutput {
  return {
    lines: Array.from(Array(9).keys(), (index) => ({
      index,
      supported: index !== 6,
      reason: "The quote carries the point of the line.",
    })),
  };
}

describe("write_briefs job", () => {
  it("W2-BRIEF-T8 (R3.2, D26): every quote on every stored line is verified against a turn or an item, using replay fixtures", async () => {
    const seeded = await seed(true);
    await writeBriefsTask(
      { meetingId: seeded.meetingId },
      makeTestJobContext({ db: workerDb, now: () => NOW }).context,
    );
    const rows = await briefRows(seeded.meetingId);
    expect(rows).toHaveLength(2);
    const turnIds = new Set([...seeded.a.turnIds, ...seeded.b.turnIds]);
    const points = rows.flatMap((row) => [...row.agree, ...row.clash, ...row.decide_first]);
    const quotes = points.flatMap((point) => point.quotes);
    expect(points).toHaveLength(18);
    expect(quotes.every((quote) => quote.verified && turnIds.has(quote.turnId))).toBe(true);
    expect(
      rows.every(
        (row) => row.model === CHAT_MODEL && row.prompt_version === readPrompt("brief").version,
      ),
    ).toBe(true);
    const ledger = await ledgerRows(seeded.meetingId, "brief");
    expect(ledger.map((entry) => entry.model)).toEqual([CHAT_MODEL, CHAT_MODEL]);
  });

  it("W2-BRIEF-T9 (A1): a judge failure after its retry gives support_reliable false and every supported null, using a missing replay fixture as the failure", async () => {
    const seeded = await seed(true);
    const empty = await makeReplayFolder([]);
    const replay = replayClient();
    const missing = replayClient(empty.root);
    const llm: LlmClient = {
      ...replay,
      complete: (args) => (isSideBJudge(args) ? missing.complete(args) : replay.complete(args)),
    };
    try {
      await writeBriefsTask(
        { meetingId: seeded.meetingId },
        { ...makeTestJobContext({ db: workerDb, now: () => NOW }).context, llm },
      );
    } finally {
      await empty.remove();
    }
    const rows = await briefRows(seeded.meetingId);
    const sideA = briefOf(rows, seeded.a.personId);
    const sideB = briefOf(rows, seeded.b.personId);
    expect(sideB.support_reliable).toBe(false);
    expect(sideB.support_rate).toBeNull();
    expect(
      [...sideB.agree, ...sideB.clash, ...sideB.decide_first].map((point) => point.supported),
    ).toEqual(Array.from(Array(9), () => null));
    expect(sideB.support_raw).toEqual({ error: "replay_fixture_missing" });
    expect(sideA.support_reliable).toBe(true);
    const judged = await ledgerRows(seeded.meetingId, "brief_support_judge");
    expect(judged.filter((entry) => entry.status === "error")).toHaveLength(2);
    expect(judged.filter((entry) => entry.status === "ok")).toHaveLength(1);
    const ready = await readyEvents(seeded.meetingId);
    expect(ready).toHaveLength(1);
    expect((ready[0]?.payload as { supportRate: { b: number | null } }).supportRate.b).toBeNull();
  });

  it("W2-BRIEF-T10 (R11.2, ARCHITECTURE.md 4.8): brief.ready is written once, after both briefs and both checks, and a second run writes nothing", async () => {
    const seeded = await seed(true);
    const made = makeTestJobContext({ db: workerDb, now: () => NOW });
    await writeBriefsTask({ meetingId: seeded.meetingId }, made.context);
    const ready = await readyEvents(seeded.meetingId);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.seq).toBe(9);
    const rates = (ready[0]?.payload as { supportRate: { a: number | null; b: number | null } })
      .supportRate;
    const rows = await briefRows(seeded.meetingId);
    const sideA = rows.find((row) => row.person_id === seeded.a.personId);
    expect(rates.a).toBe(Number(sideA?.support_rate));
    expect(rates.b).toBe(1);
    const before = await countsOf(seeded.meetingId);
    await writeBriefsTask({ meetingId: seeded.meetingId }, made.context);
    expect(await countsOf(seeded.meetingId)).toEqual(before);
  });

  it("W2-BRIEF-T11 (A1 fail-closed): a line the judge marks unsupported is stored with supported false and the rate reflects it", async () => {
    const seeded = await seed(true);
    const replay = replayClient();
    const llm: LlmClient = {
      ...replay,
      complete: async (args) => {
        const reply = await replay.complete(args);
        if (args.callSite === "brief_support_judge" && !isSideBJudge(args))
          return { ...reply, parsed: judgeWithIndexSix() };
        return reply;
      },
    };
    await writeBriefsTask(
      { meetingId: seeded.meetingId },
      { ...makeTestJobContext({ db: workerDb, now: () => NOW }).context, llm },
    );
    const sideA = (await briefRows(seeded.meetingId)).find(
      (row) => row.person_id === seeded.a.personId,
    );
    expect(sideA?.decide_first[0]?.supported).toBe(false);
    expect(Number(sideA?.support_rate)).toBe(0.889);
  });

  it("W2-BRIEF-T12 (D58): a limiter-busy error re-enqueues the job 5 s later and writes no brief, using a fake llm client and says so", async () => {
    const seeded = await seed(true);
    const made = makeTestJobContext({ db: workerDb, now: () => NOW });
    const busy: LlmClient = {
      complete: () => Promise.reject(new LimiterBusy(NOW.getTime() + 5_000)),
      stream: () => Promise.reject(new LimiterBusy(NOW.getTime() + 5_000)),
      image: () => Promise.reject(new LimiterBusy(NOW.getTime() + 5_000)),
    };
    await definePayloadTask("write_briefs", writeBriefsTask, { ...made.context, llm: busy })({
      meetingId: seeded.meetingId,
    });
    expect(made.enqueued).toEqual([
      {
        name: "write_briefs",
        payload: { meetingId: seeded.meetingId },
        options: { runAt: new Date(NOW.getTime() + 5_000) },
      },
    ]);
    expect(JOB_MAX_ATTEMPTS.write_briefs).toBe(2);
    expect(await briefRows(seeded.meetingId)).toHaveLength(0);
  });

  it("W2-BRIEF-T13 (R9.6): a meeting that is not ended gets no brief and the job returns success", async () => {
    const seeded = await seed(false);
    await expect(
      writeBriefsTask(
        { meetingId: seeded.meetingId },
        makeTestJobContext({ db: workerDb, now: () => NOW }).context,
      ),
    ).resolves.toBeUndefined();
    expect(await briefRows(seeded.meetingId)).toHaveLength(0);
    expect(await ledgerRows(seeded.meetingId, "brief")).toHaveLength(0);
  });
});

// How many briefs, committed events and model calls a meeting has, to check that a second run adds nothing.
async function countsOf(
  meetingId: string,
): Promise<{ briefs: number; events: number; ledger: number }> {
  const briefs = (await briefRows(meetingId)).length;
  const events = await countEvents(meetingId);
  const ledger =
    (await ledgerRows(meetingId, "brief")).length +
    (await ledgerRows(meetingId, "brief_support_judge")).length;
  return { briefs, events, ledger };
}

// The number of committed events of one meeting.
async function countEvents(meetingId: string): Promise<number> {
  return withMeeting(workerDb, meetingId, async (trx) => {
    const rows = await trx
      .selectFrom("meeting_events")
      .select("seq")
      .where("meeting_id", "=", meetingId)
      .execute();
    return rows.length;
  });
}
