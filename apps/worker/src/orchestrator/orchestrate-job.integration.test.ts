import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDatabase, POOL_SIZE, withPerson, type Database } from "@meet-first/db";
import { createPairedMeetingWithTurns, freshTestDatabase, type SeededMeeting, type TestDatabase } from "@meet-first/db/testing";
import type { LiveCaller, LlmRequest } from "@meet-first/llm";
import { makeTestJobContext } from "../testing/index.js";
import { orchestrate } from "./orchestrate-job.js";
import { PLAN_FAILED_SENTENCE } from "./plan-requests.js";

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let m: SeededMeeting;

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
  m = await createPairedMeetingWithTurns(fresh.db);
});

afterAll(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// A fake model that answers every call with this content and keeps each request it saw.
function fakeModel(content: string | (() => never)): { live: LiveCaller; seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  const live: LiveCaller = (request) => {
    seen.push(request);
    if (typeof content !== "string") content();
    return Promise.resolve({
      response: { id: "test", object: "chat.completion", model: "muse-spark-1.3", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } },
      usage: { promptTokens: 10, cachedTokens: 0, completionTokens: 10, reasoningTokens: 0 },
      requestId: null,
      httpStatus: 200,
    });
  };
  return { live, seen };
}

// Writes A's message and a thinking reply that holds B as A's only friend, as POST /api/orchestrator does, and returns the reply's id.
// Both rows get the transaction's time, or the given time.
async function sendAsA(text: string, canAsk = true, at?: Date): Promise<string> {
  const time = at === undefined ? {} : { created_at: at };
  return withPerson(fresh.db, m.a.personId, async (trx) => {
    const message = await trx.insertInto("orchestrator_messages").values({ person_id: m.a.personId, role: "you", text, state: "done", ...time }).returning("id").executeTakeFirstOrThrow();
    const snapshot = JSON.stringify([{ pairId: m.pairId, displayName: "Test B", canAsk }]);
    const reply = await trx.insertInto("orchestrator_messages").values({ person_id: m.a.personId, role: "agent", text: "", state: "thinking", reply_to: message.id, friends_snapshot: snapshot, ...time }).returning("id").executeTakeFirstOrThrow();
    return reply.id;
  });
}

// Writes one earlier exchange of A's thread at one time, A's message and Meety's reply, as one transaction of the api would: a reply in
// words, or the friend ask about B that A ran.
async function seedExchange(text: string, replyText: string, options: { at: Date; ranAsk?: { question: string } }): Promise<void> {
  const { at, ranAsk } = options;
  await withPerson(fresh.db, m.a.personId, async (trx) => {
    const message = await trx.insertInto("orchestrator_messages").values({ person_id: m.a.personId, role: "you", text, state: "done", created_at: at }).returning("id").executeTakeFirstOrThrow();
    const reply = ranAsk === undefined
      ? { state: "done" as const, action: "reply" as const }
      : { state: "running" as const, action: "react" as const, action_question: ranAsk.question, action_friend_name: "Test B", action_pair_id: m.pairId };
    await trx.insertInto("orchestrator_messages").values({ person_id: m.a.personId, role: "agent", text: replyText, reply_to: message.id, created_at: at, ...reply }).execute();
  });
}

// The user message of the one model call a fake model saw.
function userTextSeen(seen: readonly LlmRequest[]): string {
  const messages = seen[0]?.body.messages;
  const user = Array.isArray(messages) ? (messages[1] as { content?: unknown } | undefined) : undefined;
  return typeof user?.content === "string" ? user.content : "";
}

// Reads one of A's replies as A.
async function readReply(id: string): Promise<{ state: string; text: string; action: string | null; action_question: string | null; action_friend_name: string | null; action_pair_id: string | null }> {
  return withPerson(fresh.db, m.a.personId, (trx) => trx.selectFrom("orchestrator_messages").select(["state", "text", "action", "action_question", "action_friend_name", "action_pair_id"]).where("id", "=", id).executeTakeFirstOrThrow());
}

// Runs the job once for one of A's replies with a fake model.
async function runFor(replyId: string, live: LiveCaller): Promise<void> {
  const { context } = makeTestJobContext({ db: workerDb, live });
  await orchestrate({ messageId: replyId, personId: m.a.personId }, context);
}

describe("the orchestrate job", () => {
  it("W7-ORCH-T1: a react plan naming B becomes planned, with B's pair and stored name, and the model saw the message and the friend line", async () => {
    const replyId = await sendAsA("How would Test B react if I moved demo day to a Saturday?");
    const model = fakeModel(JSON.stringify({ action: "react", friend: "test b", question: "How would you probably react if I moved demo day to a Saturday?", reply: "I can ask Test B's agent." }));

    await runFor(replyId, model.live);

    expect(await readReply(replyId)).toEqual({
      state: "planned", text: "I can ask Test B's agent.", action: "react", action_question: "How would you probably react if I moved demo day to a Saturday?", action_friend_name: "Test B", action_pair_id: m.pairId,
    });
    const user = JSON.stringify(model.seen[0]?.body);
    expect(user).toContain("Test B | can be asked: yes");
    expect(user).toContain("<message>How would Test B react if I moved demo day to a Saturday?</message>");
    expect(model.seen[0]?.callSite).toBe("orchestrator");
  });

  it("W7-ORCH-T2: a reply that is no longer thinking is left as it is, with no second model call", async () => {
    const replyId = await sendAsA("Who could help me get my first ten users?");
    const first = fakeModel(JSON.stringify({ action: "help", friend: "", question: "Who could help me get my first ten users?", reply: "I can run a help search." }));
    await runFor(replyId, first.live);
    const second = fakeModel(JSON.stringify({ action: "reply", friend: "", question: "", reply: "Something else." }));

    await runFor(replyId, second.live);

    expect(second.seen).toHaveLength(0);
    expect((await readReply(replyId)).text).toBe("I can run a help search.");
  });

  it("W7-ORCH-T3: a friend whose switch is off is turned into words only, never a planned ask", async () => {
    const replyId = await sendAsA("How would Test B react if I left the team?", false);
    const model = fakeModel(JSON.stringify({ action: "react", friend: "Test B", question: "How would you probably react if I left the team?", reply: "I can ask Test B's agent." }));

    await runFor(replyId, model.live);

    expect(await readReply(replyId)).toMatchObject({ state: "done", action: "reply", text: "Test B has not turned on friend asks yet.", action_pair_id: null, action_question: null });
  });

  it("W7-ORCH-T4: a failed model call writes failed with the sentence, and no action", async () => {
    const replyId = await sendAsA("How would Test B react to a group trip?");
    const model = fakeModel(() => {
      throw new Error("network down");
    });

    await runFor(replyId, model.live);

    expect(await readReply(replyId)).toMatchObject({ state: "failed", text: PLAN_FAILED_SENTENCE, action: null });
  });

  it("W7-ORCH-T5: a reply that breaks the schema fails the same way", async () => {
    const replyId = await sendAsA("How would Test B react to a group trip?");
    const model = fakeModel(JSON.stringify({ action: "ask_everyone", friend: "", question: "", reply: "" }));

    await runFor(replyId, model.live);

    expect(await readReply(replyId)).toMatchObject({ state: "failed", text: PLAN_FAILED_SENTENCE });
  });

  it("W7-ORCH-T6: the next message shows the earlier exchange in <recent>, oldest first", async () => {
    const firstId = await sendAsA("How would Test B react if I moved our trip to March?");
    await runFor(firstId, fakeModel(JSON.stringify({ action: "react", friend: "Test B", question: "How would you probably react if I moved our trip to March?", reply: "I can ask Test B's agent about March." })).live);
    const nextId = await sendAsA("and what about April?");
    const model = fakeModel(JSON.stringify({ action: "reply", friend: "", question: "", reply: "Tell me more." }));

    await runFor(nextId, model.live);

    const body = JSON.stringify(model.seen[0]?.body);
    expect(body).toContain("you: How would Test B react if I moved our trip to March?\\nmeety: I can ask Test B's agent about March.\\n</recent>");
  });

  it("W7-CHECK-T3: when the planned friend's pair is gone before the plan is written, the reply says so and the job ends, with no second model call", async () => {
    const replyId = await withPerson(fresh.db, m.a.personId, async (trx) => {
      const message = await trx.insertInto("orchestrator_messages").values({ person_id: m.a.personId, role: "you", text: "How would Gone react to a later demo?", state: "done" }).returning("id").executeTakeFirstOrThrow();
      const snapshot = JSON.stringify([{ pairId: "00000000-0000-4000-8000-0000000009ff", displayName: "Gone", canAsk: true }]);
      return (await trx.insertInto("orchestrator_messages").values({ person_id: m.a.personId, role: "agent", text: "", state: "thinking", reply_to: message.id, friends_snapshot: snapshot }).returning("id").executeTakeFirstOrThrow()).id;
    });
    const model = fakeModel(JSON.stringify({ action: "react", friend: "Gone", question: "How would you probably react to a later demo?", reply: "I can ask Gone's agent." }));

    await runFor(replyId, model.live);
    await runFor(replyId, model.live);

    expect(await readReply(replyId)).toMatchObject({ state: "done", action: "reply", text: "You are no longer friends with Gone, so I cannot ask their agent.", action_pair_id: null });
    expect(model.seen).toHaveLength(1);
  });

  it("W7-ORCH-T7: the 3 Nov chat: after a friend ask and four corrections, each answered with a question back, the next message still shows the first question", async () => {
    const exchanges: [string, string][] = [
      ["How would Test B react if I told them the integral of sin x from 0 to pi is 0?", "I can ask Test B's agent how they would probably react if you told them the integral of sin x from 0 to pi is 0. Press the button when you are ready; Test B will get a copy."],
      ["no not the integral but sum of", "What would you like me to ask Test B about the sum?"],
      ["sum of sines", "What would you like me to ask Test B about the sum of sines?"],
      ["0 to pi", "What would you like me to ask Test B about the sum of sines from 0 to pi?"],
      ["iit being 1 not 0", "What would you like me to ask Test B about the sum being 1?"],
    ];
    const ranAsk = { question: "How would you probably react if I told you the integral of sin x from 0 to pi is 0?" };
    // One second apart and an hour after the earlier tests' rows, so the order never rests on the clock moving between two transactions.
    const start = Date.now() + 3_600_000;
    for (const [index, [text, replyText]] of exchanges.entries()) {
      await seedExchange(text, replyText, { at: new Date(start + index * 1000), ...(index === 0 ? { ranAsk } : {}) });
    }
    const replyId = await sendAsA("the sum", true, new Date(start + exchanges.length * 1000));
    const model = fakeModel(JSON.stringify({ action: "reply", friend: "", question: "", reply: "Tell me more." }));

    await runFor(replyId, model.live);

    const lines = userTextSeen(model.seen).split("\n");
    expect(lines.slice(lines.indexOf("<recent>") + 1, lines.indexOf("</recent>"))).toEqual(exchanges.flatMap(([text, replyText]) => [`you: ${text}`, `meety: ${replyText}`]));
  });
});
