import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { QUIZ_BANK, RecordedCall, sampleQuiz, rowToEvent, type CommittedEvent } from "@meet-first/contracts";
import { readPrompt } from "@meet-first/prompts";
import { makeDatabase, parseDatabaseError, POOL_SIZE, withMeeting, withPerson, type Database } from "@meet-first/db";
import { createPairedMeeting, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { makeMeetingTestContext, runMeetingJob, startTestMeeting, type MeetingTestContext } from "./testing/meeting-test-context.js";
import { type ReplyScript } from "./testing/scripted-replies.js";

// The question a free-text meeting asks in these tests.
const FREE_TEXT = "Should we split the work by strengths or by interest?";

// The seeded meeting of one test.
type Seeded = Awaited<ReturnType<typeof createPairedMeeting>>;

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let m: Seeded;
let created: string[];
const contexts: MeetingTestContext[] = [];

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});

beforeEach(async () => {
  m = await createPairedMeeting(fresh.db, { questionId: 3 });
  created = [m.meetingId];
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

// Opens a meeting test context over the shared worker database with this script.
async function openTest(script: ReplyScript): Promise<MeetingTestContext> {
  const context = await makeMeetingTestContext({ db: workerDb, script, clockStart: new Date() });
  contexts.push(context);
  return context;
}

// The question check script of one run.
function questionCheck(verdict: unknown): ReplyScript {
  return { speech: [], receipts: [], questionCheck: [verdict] };
}

// Makes the test meeting free text that has not been checked yet, with the kind a new free-text meeting has (ARCHITECTURE.md 4.1).
async function freeText(meetingId: string): Promise<void> {
  await withMeeting(workerDb, meetingId, (trx) => trx.updateTable("meetings")
    .set({ question_id: null, question_text: FREE_TEXT, question_checked_at: null, question_kind: "situation" }).where("id", "=", meetingId).execute());
}

// One meeting row, as the checks read it.
async function meetingOf(meetingId: string) {
  return withMeeting(workerDb, meetingId, (trx) => trx.selectFrom("meetings").selectAll().where("id", "=", meetingId).executeTakeFirstOrThrow());
}

// The two members of a meeting, in side order.
async function membersOf(meetingId: string) {
  return withMeeting(workerDb, meetingId, (trx) => trx.selectFrom("meeting_members").selectAll().where("meeting_id", "=", meetingId).orderBy("side").execute());
}

// Every committed event of a meeting, in seq order.
async function eventsOf(meetingId: string): Promise<CommittedEvent[]> {
  const rows = await withMeeting(workerDb, meetingId, (trx) => trx.selectFrom("meeting_events")
    .select(["meeting_id", "seq", "type", "v", "payload", "created_at"]).where("meeting_id", "=", meetingId).orderBy("seq").execute());
  return rows.map(rowToEvent);
}

// The two members of a meeting in side order, as named values; a meeting without two members is a broken seed.
async function sidesOf(meetingId: string): Promise<{ a: Member; b: Member }> {
  const [a, b] = await membersOf(meetingId);
  if (a === undefined || b === undefined) throw new Error("The meeting has no two members.");
  return { a, b };
}

// One member row of a meeting.
type Member = Awaited<ReturnType<typeof membersOf>>[number];

// The text of the moderator prompt, read the same way the job reads it.
function moderatorText(): string {
  return readPrompt("meeting-moderator").text;
}

it("R10.5-T1: an allowed free-text question is marked checked and both prefixes are stored", async () => {
  await freeText(m.meetingId);
  const t = await openTest(questionCheck({ allowed: true, reason: "A question about splitting work.", kind: "decision" }));
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  const checked = await meetingOf(m.meetingId);
  expect(checked.question_checked_at).not.toBeNull();
  expect(checked.question_kind).toBe("decision");
  const { a, b } = await sidesOf(m.meetingId);
  const prefix = a.frozen_prefix ?? "";
  expect(prefix.startsWith(moderatorText().slice(0, 40))).toBe(true);
  expect(b.frozen_prefix).not.toBeNull();
  expect(a.frozen_prefix_tokens).toBe(Math.ceil(prefix.length / 1.33));
  expect(b.frozen_prefix_tokens).toBe(Math.ceil((b.frozen_prefix ?? "").length / 1.33));
  expect(prefix).toContain("your human: Test A");
  expect(prefix).toContain('<meeting_question kind="decision">\n' + FREE_TEXT + "\n</meeting_question>");
  const ledger = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("ledger").select("call_site").where("meeting_id", "=", m.meetingId).execute());
  expect(ledger.map((row) => row.call_site)).toEqual(["question_check"]);
  const call = RecordedCall.parse(JSON.parse(readFileSync(t.client.written[0] ?? "", "utf8")) as unknown);
  expect((call.request.body.messages as Array<{ content: string }>)[1]?.content).toBe("<meeting_question>\n" + FREE_TEXT + "\n</meeting_question>");
});

it("R10.5-T2: a refused free-text question keeps its reason and gets no prefix", async () => {
  await freeText(m.meetingId);
  const t = await openTest(questionCheck({ allowed: false, reason: "Questions about health are not allowed.", kind: "situation" }));
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  const meeting = await meetingOf(m.meetingId);
  expect(meeting.question_rejected_reason).toBe("Questions about health are not allowed.");
  expect(meeting.question_checked_at).toBeNull();
  expect(meeting.question_kind).toBe("situation");
  for (const side of await membersOf(m.meetingId)) {
    expect(side.frozen_prefix).toBeNull();
    expect(side.frozen_prefix_tokens).toBeNull();
  }
});

it("D41-T4: a curated question needs no model call and gets both prefixes, which carry the curated question's kind", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  for (const side of await membersOf(m.meetingId)) expect(side.frozen_prefix).toContain('<meeting_question kind="get_along">');
  expect(t.client.written).toHaveLength(0);
  const ledger = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("ledger").select("id").where("meeting_id", "=", m.meetingId).execute());
  expect(ledger).toHaveLength(0);
});

it("D41-T5: a second run of the job changes no prefix", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  const first = await membersOf(m.meetingId);
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  const second = await membersOf(m.meetingId);
  expect(second.map((side) => side.frozen_prefix)).toEqual(first.map((side) => side.frozen_prefix));
});

it("invariant-9-T1: the job writes no prefix once the meeting runs, and the trigger refuses a change", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  const before = await membersOf(m.meetingId);
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  expect((await membersOf(m.meetingId)).map((side) => side.frozen_prefix)).toEqual(before.map((side) => side.frozen_prefix));
  const refusal = await withMeeting(workerDb, m.meetingId, (trx) => trx.updateTable("meeting_members").set({ frozen_prefix: "x" }).where("side", "=", "a").execute())
    .then(() => undefined, (error: unknown) => error);
  expect(parseDatabaseError(refusal)?.code).toBe("prefix_frozen");
});

it("D31-T2: a judged quiz's misses enter that side's prefix and only that side's", async () => {
  const ids = sampleQuiz(m.a.cardId);
  await withPerson(workerDb, m.a.personId, async (trx) => {
    const quiz = await trx.insertInto("quizzes").values({
      card_id: m.a.cardId, person_id: m.a.personId, bank_version: 1, seed: m.a.cardId, state: "judged", matched: 9, reliable: true, judge_runs: 1,
    }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("quiz_items").values(ids.map((questionId, index) => ({
      quiz_id: quiz.id, person_id: m.a.personId, position: index + 1, bank_version: 1, question_id: questionId,
      persona_answer: "p", human_answer: "h", flipped: false, agree: index !== 0,
    }))).execute();
  });
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  const { a, b } = await sidesOf(m.meetingId);
  const missText = QUIZ_BANK[(ids[0] ?? 1) - 1]?.text ?? "";
  expect(a.frozen_prefix).toContain("<do_not_guess>\n- " + missText + "\n</do_not_guess>");
  // The moderator text names the tag in its own rules, so the check is that side b holds none of side a's misses.
  expect(b.frozen_prefix).not.toContain(missText);
});

it("D57-T2: a meeting whose two go-aheads came first starts when its prefixes are stored, with nobody online", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await withMeeting(workerDb, m.meetingId, (trx) => trx.updateTable("meeting_members").set({ ready_at: new Date(), last_seen_at: null })
    .where("meeting_id", "=", m.meetingId).execute());
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  expect((await meetingOf(m.meetingId)).state).toBe("running");
  const steps = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meeting_steps").selectAll().where("meeting_id", "=", m.meetingId).execute());
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({ step_seq: 1, side: "a", phase: "open", state: "pending" });
  const events = await eventsOf(m.meetingId);
  expect(events.map((event) => event.seq).slice(0, 2)).toEqual([1, 2]);
  expect(events[0]?.type).toBe("meeting.started");
  expect(events[1]?.type).toBe("phase.changed");
  expect(t.pending.filter((job) => job.name === "meeting_step")).toEqual([
    { name: "meeting_step", payload: { meetingId: m.meetingId, stepSeq: 1 }, options: undefined },
  ]);
});

it("D57-T3: with one go-ahead missing, the job stores the prefixes and does not start the meeting", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await withMeeting(workerDb, m.meetingId, (trx) => trx.updateTable("meeting_members").set({ ready_at: new Date() })
    .where("meeting_id", "=", m.meetingId).where("side", "=", "a").execute());
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  for (const side of await membersOf(m.meetingId)) expect(side.frozen_prefix).not.toBeNull();
  expect((await meetingOf(m.meetingId)).state).toBe("ready");
  const steps = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meeting_steps").select("id").where("meeting_id", "=", m.meetingId).execute());
  expect(steps).toHaveLength(0);
  expect(await eventsOf(m.meetingId)).toHaveLength(0);
  expect(t.pending.some((job) => job.name === "meeting_step")).toBe(false);
});
