import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { RecordedCall, rowToEvent, type CommittedEvent } from "@meet-first/contracts";
import { makeDatabase, parseDatabaseError, POOL_SIZE, withMeeting, withPerson, type Database } from "@meet-first/db";
import { createPairedMeeting, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { claimStep, releaseStep } from "./claim-step.js";
import { commitTurn } from "./commit-turn.js";
import { drainJobs, makeMeetingTestContext, readSideItems, runMeetingJob, startTestMeeting, type MeetingTestContext } from "./testing/meeting-test-context.js";
import { firstWords } from "./testing/golden-path-meeting.js";
import { type ReplyScript, type ScriptedSpeech } from "./testing/scripted-replies.js";

// The speech of side a in its first turn, and of side b in its second: fixed texts the tests check for.
const S1 = "My human wants clear ownership of each part of the work.";
const S2 = "My human agrees that ownership should be clear.";

// One approved card item of a side, as readSideItems returns it.
type Item = Awaited<ReturnType<typeof readSideItems>>[number];
// The seeded meeting of one test.
type Seeded = Awaited<ReturnType<typeof createPairedMeeting>>;

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let m: Seeded;
let created: string[];
let itemsA: Item[];
let itemsB: Item[];
const contexts: MeetingTestContext[] = [];

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});

beforeEach(async () => {
  m = await createPairedMeeting(fresh.db, { questionId: 3 });
  created = [m.meetingId];
  await allowRecall(m.a.personId, m.a.cardId, true);
  await allowRecall(m.b.personId, m.b.cardId, true);
  itemsA = await readSideItems(workerDb, m.meetingId, "a");
  itemsB = await readSideItems(workerDb, m.meetingId, "b");
});

afterEach(async () => {
  for (const id of created) {
    await withMeeting(workerDb, id, (trx) => trx.updateTable("meetings").set({ state: "deleted" }).where("id", "=", id).execute());
  }
  for (const context of contexts.splice(0)) await context.close();
});

afterAll(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// A speech reply that says plain text.
function text(value: string): ScriptedSpeech {
  return { text: value };
}

// A speech reply that makes one recall call and no text.
function recall(query: string): ScriptedSpeech {
  return { text: "", toolCalls: [{ name: "recall", arguments: { query } }] };
}

// A verified card quote as a receipt claim: it passes the quote check inside its turn.
function claimOf(item: Item): { text: string; quote: string; turn_id: string; lang: string; gloss: string } {
  return { text: item.claim, quote: item.quote, turn_id: String(item.turnIndex), lang: item.lang, gloss: item.gloss };
}

// The first item of a list; a test with no items is a broken seed, so it fails here.
function first(items: Item[]): Item {
  const item = items[0];
  if (item === undefined) throw new Error("The seeded side has no approved items.");
  return item;
}

// Sets the recall flag of one person's card, as the owner (a meeting context reads cards and never writes them).
async function allowRecall(personId: string, cardId: string, isAllowed: boolean): Promise<void> {
  await withPerson(workerDb, personId, (trx) => trx.updateTable("cards").set({ recall_allowed: isAllowed }).where("id", "=", cardId).execute());
}

// Opens a meeting test context over the shared worker database with this script.
async function openTest(script: ReplyScript): Promise<MeetingTestContext> {
  const context = await makeMeetingTestContext({ db: workerDb, script, clockStart: new Date() });
  contexts.push(context);
  return context;
}

// The step row of the test meeting at this step number.
async function stepOf(stepSeq: number) {
  return withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meeting_steps").selectAll()
    .where("meeting_id", "=", m.meetingId).where("step_seq", "=", stepSeq).executeTakeFirstOrThrow());
}

// Every committed event of the test meeting, in seq order.
async function eventsOf(): Promise<CommittedEvent[]> {
  const rows = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meeting_events")
    .select(["meeting_id", "seq", "type", "v", "payload", "created_at"]).where("meeting_id", "=", m.meetingId).orderBy("seq").execute());
  return rows.map(rowToEvent);
}

// How many ledger rows the test meeting has for one call site.
async function ledgerCount(callSite: string): Promise<number> {
  const rows = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("ledger").select("id").where("meeting_id", "=", m.meetingId).where("call_site", "=", callSite).execute());
  return rows.length;
}

it("D44-T1: claims step 1 once when 20 runners race", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  const results = await Promise.all(Array.from({ length: 20 }, () => withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1))));
  expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
  expect(results.filter((result) => result.kind === "busy")).toHaveLength(19);
  const row = await stepOf(1);
  expect(row.attempt).toBe(1);
  expect(row.state).toBe("running");
});

it("invariant-10-T1: a claim of a done step returns its stored output, using the drain", async () => {
  const t = await openTest({ speech: [text(S1)], receipts: [{ claims: [] }], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await drainJobs(t, { limit: 1, names: ["meeting_step"] });
  const outcome = await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
  expect(outcome.kind).toBe("done");
  if (outcome.kind !== "done") throw new Error("The step was not done.");
  expect(outcome.output.text).toBe(S1);
  expect(outcome.output.claimsCommitted).toBe(0);
  const step1 = await stepOf(1);
  expect(step1.state).toBe("done");
  expect(step1.output).not.toBeNull();
  expect(await stepOf(2)).toMatchObject({ side: "b", phase: "open", state: "pending" });
});

it("D44-T2: a runner that lost its claim commits nothing", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
  await withMeeting(workerDb, m.meetingId, (trx) => releaseStep(trx, { meetingId: m.meetingId, stepSeq: 1, attempt: 1 }, "stalled"));
  await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
  const result = await commitTurn(t.context, {
    meetingId: m.meetingId, stepSeq: 1, side: "a", phase: "open", attempt: 1, personId: m.a.personId, cardId: m.a.cardId,
    text: "late text", requestsMade: 1, hasDecision: false, claims: [], toolCalls: [],
  });
  expect(result).toEqual({ kind: "lost" });
  expect((await eventsOf()).filter((event) => event.type === "turn.committed")).toHaveLength(0);
  expect(await stepOf(1)).toMatchObject({ state: "running", attempt: 2 });
});

it("invariant-11-T1: a commit that fails at its claims insert leaves the step running and writes no turn.committed", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
  const failure = await commitTurn(t.context, {
    meetingId: m.meetingId, stepSeq: 1, side: "a", phase: "open", attempt: 1, personId: m.a.personId, cardId: m.a.cardId,
    text: S1, requestsMade: 1, hasDecision: false,
    claims: [{ text: "c", quote: "q", lang: "en", gloss: "g", turnId: first(itemsB).turnId, isVerified: false, isRegenerated: false }],
    toolCalls: [],
  }).then(() => undefined, (error: unknown) => error);
  expect(parseDatabaseError(failure)?.code).toBe("claim_foreign_turn");
  const step1 = await stepOf(1);
  expect(step1.state).toBe("running");
  expect(step1.output).toBeNull();
  expect((await eventsOf()).filter((event) => event.type === "turn.committed")).toHaveLength(0);
  const claims = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("claims").select("id").where("meeting_id", "=", m.meetingId).execute());
  expect(claims).toHaveLength(0);
});

it("invariant-6-T1: the claims trigger refuses a claim that cites the other side's turn", async () => {
  const insertClaim = (turnId: string) => withMeeting(workerDb, m.meetingId, (trx) => trx.insertInto("claims").values({
    meeting_id: m.meetingId, step_seq: 1, side: "a", person_id: m.a.personId, position: 1, text: "c", quote: "q", gloss: "g", lang: "en",
    turn_id: turnId, verified: true, flagged: false, evidence_valid: true,
  }).execute());
  const foreign = await insertClaim(first(itemsB).turnId).then(() => undefined, (error: unknown) => error);
  expect(parseDatabaseError(foreign)?.code).toBe("claim_foreign_turn");
  await insertClaim(first(itemsA).turnId);
  const rows = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("claims").select("id").where("meeting_id", "=", m.meetingId).execute());
  expect(rows).toHaveLength(1);
});

it("D61-T2: at 1,500,000 ledger tokens the next step ends the meeting with reason budget", async () => {
  const t = await openTest({ speech: [text(S1)], receipts: [{ claims: [] }], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await withMeeting(workerDb, m.meetingId, (trx) => trx.insertInto("ledger").values({
    meeting_id: m.meetingId, person_id: null, call_site: "speech", model: "muse-spark-1.3", effort: "low", est_tokens: 0,
    prompt_tokens: 1_500_000, completion_tokens: 0, status: "ok", llm_mode: "replay",
  }).execute());
  await runMeetingJob(t, "meeting_step", { meetingId: m.meetingId, stepSeq: 1 });
  const meeting = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meetings").select(["state", "end_reason"]).where("id", "=", m.meetingId).executeTakeFirstOrThrow());
  expect(meeting).toEqual({ state: "ended", end_reason: "budget" });
  const ended = (await eventsOf()).filter((event) => event.type === "meeting.ended");
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ type: "meeting.ended", reason: "budget" });
  expect(t.pending.filter((job) => job.name === "write_briefs")).toHaveLength(1);
  expect(t.client.written).toHaveLength(0);
  expect((await stepOf(1)).state).toBe("stalled");
});

it("R6.5-T2: a fabricated quote is regenerated once and stored flagged, using the drain", async () => {
  const fabricated = { claims: [{ text: "c", quote: "this sentence never appeared in any turn", turn_id: String(first(itemsA).turnIndex), lang: "en", gloss: "c" }] };
  const t = await openTest({ speech: [text(S1)], receipts: [fabricated, fabricated], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await drainJobs(t, { limit: 1, names: ["meeting_step"] });
  const claims = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("claims").selectAll().where("meeting_id", "=", m.meetingId).execute());
  expect(claims).toHaveLength(1);
  expect(claims[0]).toMatchObject({ verified: false, flagged: true, regenerated: true, evidence_valid: true });
  const committed = (await eventsOf()).find((event) => event.type === "turn.committed");
  expect(committed?.type === "turn.committed" ? committed.claims[0]?.flagged : undefined).toBe(true);
  expect(await ledgerCount("receipts")).toBe(2);
});

it("D38-T1: recall returns up to 5 turns for a side with recall on and none for a side with recall off, using the drain", async () => {
  await allowRecall(m.b.personId, m.b.cardId, false);
  const t = await openTest({
    speech: [recall(firstWords(first(itemsA).quote)), text(S1), recall(firstWords(first(itemsB).quote)), text(S2)],
    receipts: [{ claims: [] }, { claims: [] }],
    questionCheck: [],
  });
  await startTestMeeting(t, m.meetingId);
  await drainJobs(t, { limit: 2, names: ["meeting_step"] });
  const results = (await eventsOf()).filter((event) => event.type === "tool.result" && event.tool === "recall");
  const sideA = results.find((event) => event.type === "tool.result" && event.side === "a");
  const sideB = results.find((event) => event.type === "tool.result" && event.side === "b");
  const turnsA = sideA?.type === "tool.result" ? (sideA.result.turns as Array<{ text: string }>) : [];
  expect(turnsA.length).toBeGreaterThanOrEqual(1);
  expect(turnsA.length).toBeLessThanOrEqual(5);
  for (const turn of turnsA) expect(turn.text.length).toBeLessThanOrEqual(600);
  expect(sideB?.type === "tool.result" ? sideB.result.turns : undefined).toEqual([]);
  const step2 = await stepOf(2);
  expect(JSON.stringify(step2.messages)).toContain("<recall_result>\\nno matching turns\\n</recall_result>");
});

it("R5.1-T7: a step that failed after a tool round resumes from its saved messages without sending that round again, using the drain", async () => {
  const script: ReplyScript = { speech: [recall(firstWords(first(itemsA).quote))], receipts: [], questionCheck: [] };
  const t = await openTest(script);
  await startTestMeeting(t, m.meetingId);
  await drainJobs(t, { limit: 1, names: ["meeting_step"] });
  expect(await stepOf(1)).toMatchObject({ state: "stalled", tool_rounds: 1 });
  expect((await stepOf(1)).messages).toHaveLength(4);
  script.speech.push(text(S1));
  script.receipts.push({ claims: [] });
  await runMeetingJob(t, "meeting_step", { meetingId: m.meetingId, stepSeq: 1 });
  expect(await stepOf(1)).toMatchObject({ state: "done" });
  const committed = (await eventsOf()).find((event) => event.type === "turn.committed");
  expect(committed?.type === "turn.committed" ? committed.text : undefined).toBe(S1);
  expect(await ledgerCount("speech")).toBe(2);
});

it("D39-T1: a turn sends one streamed speech request per round and one strict receipts request with no tools, using the drain", async () => {
  const t = await openTest({ speech: [recall(firstWords(first(itemsA).quote)), text(S1)], receipts: [{ claims: [claimOf(first(itemsA))] }], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await drainJobs(t, { limit: 1, names: ["meeting_step"] });
  const calls = t.client.written.map((path) => RecordedCall.parse(JSON.parse(readFileSync(path, "utf8")) as unknown));
  const speech = calls.filter((call) => call.callSite === "speech");
  const receipts = calls.filter((call) => call.callSite === "receipts");
  expect(speech).toHaveLength(2);
  expect(receipts).toHaveLength(1);
  for (const call of speech) {
    expect(call.request.body.stream).toBe(true);
    expect(String(call.request.body.prompt_cache_key)).toMatch(/^meeting:[0-9a-f]{32}:a$/);
    expect((call.request.body.messages as Array<{ role: string }>)[0]?.role).toBe("system");
  }
  expect(((speech[0]?.request.body.tools ?? []) as Array<{ function: { name: string } }>).map((tool) => tool.function.name)).toEqual(["recall"]);
  const receiptsBody = receipts[0]?.request.body ?? {};
  expect((receiptsBody.response_format as { type: string }).type).toBe("json_schema");
  expect(receiptsBody).not.toHaveProperty("tools");
  expect(receiptsBody).not.toHaveProperty("stream");
  const claims = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("claims").selectAll().where("meeting_id", "=", m.meetingId).execute());
  expect(claims[0]).toMatchObject({ verified: true, evidence_valid: true });
  expect(await ledgerCount("speech")).toBe(2);
  expect(await ledgerCount("receipts")).toBe(1);
});

it("R5.11-T1: every event of a turn is a committed event with v 1 and a gapless seq", async () => {
  const t = await openTest({ speech: [recall(firstWords(first(itemsA).quote)), text(S1)], receipts: [{ claims: [claimOf(first(itemsA))] }], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await drainJobs(t, { limit: 1, names: ["meeting_step"] });
  const rows = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meeting_events").selectAll().where("meeting_id", "=", m.meetingId).orderBy("seq").execute());
  expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(rows.map((row) => row.type)).toEqual(["meeting.started", "phase.changed", "tool.called", "tool.result", "turn.committed"]);
  for (const row of rows) {
    expect(row.v).toBe(1);
    expect(rowToEvent(row).at).toBe(new Date(row.created_at).toISOString());
  }
});

it("D45-T1: no enqueue carries a job key, using the drain", async () => {
  const t = await openTest({ speech: [text(S1)], receipts: [{ claims: [] }], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  const ran = await drainJobs(t, { limit: 1, names: ["meeting_step"] });
  const entries = [...t.pending, ...ran];
  expect(entries.length).toBeGreaterThanOrEqual(2);
  for (const entry of entries) {
    expect(Object.keys(entry.options ?? {}).every((key) => key === "runAt")).toBe(true);
  }
});
