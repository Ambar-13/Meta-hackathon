import { sql, type Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { rowToEvent, type CommittedEvent } from "@meet-first/contracts";
import {
  makeDatabase,
  POOL_SIZE,
  SCHEMA_VERSION,
  withMeeting,
  type Database,
} from "@meet-first/db";
import { createPairedMeeting, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { CapReached, type LlmClient } from "@meet-first/llm";
import type { JobContext } from "../job-context.js";
import { claimStep, releaseStep } from "./claim-step.js";
import { beginRunningMeeting, commitTurn, endMeeting } from "./commit-turn.js";
import { runMeetingStep } from "./step-job.js";
import {
  MEETING_OVERTIME_GRACE_MS,
  MEETING_STEP_MAX_ATTEMPTS,
  promoteQueuedMeetings,
  runSweepStalled,
  startReadyMeetings,
} from "./sweep-stalled-job.js";
import {
  drainJobs,
  makeMeetingTestContext,
  readSideItems,
  runMeetingJob,
  startTestMeeting,
  type MeetingTestContext,
} from "./testing/meeting-test-context.js";
import { type ReplyScript, type ScriptedSpeech } from "./testing/scripted-replies.js";

// The speech of side a in its first turn: the fixed text the tests check for.
const S1 = "My human wants clear ownership of each part of the work.";

// The seeded meeting of one test.
type Seeded = Awaited<ReturnType<typeof createPairedMeeting>>;
// One approved card item of a side, as readSideItems returns it.
type Item = Awaited<ReturnType<typeof readSideItems>>[number];

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
    await withMeeting(workerDb, id, (trx) =>
      trx.updateTable("meetings").set({ state: "deleted" }).where("id", "=", id).execute(),
    );
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

// The first item of a list; a test with no items is a broken seed, so it fails here.
function first(items: Item[]): Item {
  const item = items[0];
  if (item === undefined) throw new Error("The seeded side has no approved items.");
  return item;
}

// A verified card quote as a receipt claim.
function claimOf(item: Item): {
  text: string;
  quote: string;
  turn_id: string;
  lang: string;
  gloss: string;
} {
  return {
    text: item.claim,
    quote: item.quote,
    turn_id: String(item.turnIndex),
    lang: item.lang,
    gloss: item.gloss,
  };
}

// Opens a meeting test context over the shared worker database with this script and the given kill,
// if any.
async function openTest(
  script: ReplyScript,
  killAfterReply?: { callSite: "receipts"; times: number },
): Promise<MeetingTestContext> {
  const context = await makeMeetingTestContext({
    db: workerDb,
    script,
    clockStart: new Date(),
    ...(killAfterReply === undefined ? {} : { killAfterReply }),
  });
  contexts.push(context);
  return context;
}

// The job context with the meeting limit set to n running meetings.
function slots(context: JobContext, n: number): JobContext {
  return { ...context, env: { ...context.env, MAX_CONCURRENT_MEETINGS: n } };
}

// The state of one meeting row.
async function stateOf(meetingId: string): Promise<string> {
  const row = await withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("meetings")
      .select("state")
      .where("id", "=", meetingId)
      .executeTakeFirstOrThrow(),
  );
  return row.state;
}

// The step row at this number.
async function stepOf(meetingId: string, stepSeq: number) {
  return withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("meeting_steps")
      .selectAll()
      .where("meeting_id", "=", meetingId)
      .where("step_seq", "=", stepSeq)
      .executeTakeFirstOrThrow(),
  );
}

// Every committed event of a meeting, in seq order.
async function eventsOf(meetingId: string): Promise<CommittedEvent[]> {
  const rows = await withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("meeting_events")
      .select(["meeting_id", "seq", "type", "v", "payload", "created_at"])
      .where("meeting_id", "=", meetingId)
      .orderBy("seq")
      .execute(),
  );
  return rows.map(rowToEvent);
}

// Makes a meeting look silent for 200 s: its events and its start are older than the sweep's 150 s.
async function backdate(meetingId: string): Promise<void> {
  const past = new Date(Date.now() - 200_000);
  await withMeeting(workerDb, meetingId, async (trx) => {
    await trx
      .updateTable("meeting_events")
      .set({ created_at: past })
      .where("meeting_id", "=", meetingId)
      .execute();
    await trx
      .updateTable("meetings")
      .set({ started_at: past })
      .where("id", "=", meetingId)
      .execute();
  });
}

// The approved items of a side of the test meeting, in position order.
async function readItems(side: "a" | "b"): Promise<Item[]> {
  return readSideItems(workerDb, m.meetingId, side);
}

// The state claim_meeting_slot gives a meeting, with the slot limit given (the function is the one
// place that counts running meetings).
async function claimSlot(meetingId: string, maxRunning: number): Promise<string> {
  const rows = (
    await withMeeting(workerDb, meetingId, (trx) =>
      sql<{
        state: string;
        queue_position: number | null;
      }>`SELECT state, queue_position FROM claim_meeting_slot(${meetingId}, ${maxRunning})`.execute(
        trx,
      ),
    )
  ).rows;
  return rows[0]?.state ?? "none";
}

// The state and the end reason of one meeting row.
async function endOf(meetingId: string): Promise<{ state: string; end_reason: string | null }> {
  return withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("meetings")
      .select(["state", "end_reason"])
      .where("id", "=", meetingId)
      .executeTakeFirstOrThrow(),
  );
}

// The end time claim_meeting_slot gave a running meeting; a running meeting without one is a broken
// seed.
async function endsAtOf(meetingId: string): Promise<Date> {
  const row = await withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("meetings")
      .select("ends_at")
      .where("id", "=", meetingId)
      .executeTakeFirstOrThrow(),
  );
  if (row.ends_at === null) throw new Error("The running meeting has no end time.");
  return row.ends_at;
}

// Moves the claim time of a meeting's step 1 to ms ago, as a runner that claimed it then would have
// left it.
async function claimedAgo(meetingId: string, ms: number): Promise<void> {
  const past = new Date(Date.now() - ms);
  await withMeeting(workerDb, meetingId, (trx) =>
    trx
      .updateTable("meeting_steps")
      .set({ claimed_at: past })
      .where("meeting_id", "=", meetingId)
      .where("step_seq", "=", 1)
      .execute(),
  );
}

// Writes a ledger row of 1,500,000 tokens for the meeting, so the next token check stops it.
async function reachTokenStop(meetingId: string): Promise<void> {
  await withMeeting(workerDb, meetingId, (trx) =>
    trx
      .insertInto("ledger")
      .values({
        meeting_id: meetingId,
        person_id: null,
        call_site: "speech",
        model: "muse-spark-1.3",
        effort: "low",
        est_tokens: 0,
        prompt_tokens: 1_500_000,
        completion_tokens: 0,
        status: "ok",
        llm_mode: "replay",
      })
      .execute(),
  );
}

// The write_briefs jobs a test context has recorded.
function briefsQueued(test: MeetingTestContext): MeetingTestContext["pending"] {
  return test.pending.filter((job) => job.name === "write_briefs");
}

// A promise and the function that resolves it, for a test that waits on another transaction's
// progress.
function signal(): { wait: Promise<void>; fire: () => void } {
  let fire: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { wait, fire };
}

// Waits until some session is blocked by the given backend's locks, so a test can commit that backend's transaction at that moment;
// after 5 seconds with no blocked session it throws.
async function waitUntilBlockedBy(holderPid: number): Promise<void> {
  for (let tries = 0; tries < 250; tries += 1) {
    const rows = (
      await sql<{
        waiting: number;
      }>`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid))`.execute(
        fresh.db,
      )
    ).rows;
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("No session waited on the held lock within 5 seconds.");
}

it("R5.2-T1: a worker stopped between the model reply and the commit every time runs the step at most 3 times, then the sweep ends the meeting with reason budget, using the killed reply", async () => {
  const a = await readItems("a");
  const t = await openTest(
    { speech: [text(S1)], receipts: [{ claims: [claimOf(first(a))] }], questionCheck: [] },
    { callSite: "receipts", times: 20 },
  );
  await startTestMeeting(t, m.meetingId);
  // Each round runs the step job the last sweep queued, then sweeps as the minute cron does once
  // the meeting is silent for 150 s.
  for (let round = 0; round < 21; round += 1) {
    await drainJobs(t, { limit: 1, names: ["meeting_step"] });
    await backdate(m.meetingId);
    await runMeetingJob(t, "sweep_stalled", {});
  }
  const events = await eventsOf(m.meetingId);
  expect(events.filter((event) => event.type === "turn.committed")).toHaveLength(0);
  expect(events.filter((event) => event.type === "meeting.ended")).toHaveLength(1);
  expect(await endOf(m.meetingId)).toEqual({ state: "ended", end_reason: "budget" });
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "stalled", attempt: 3 });
  const claims = await withMeeting(workerDb, m.meetingId, (trx) =>
    trx
      .selectFrom("claims")
      .select("id")
      .where("meeting_id", "=", m.meetingId)
      .where("step_seq", "=", 1)
      .execute(),
  );
  expect(claims).toHaveLength(0);
  expect(t.client.written).toHaveLength(2);
  const ledger = await withMeeting(workerDb, m.meetingId, (trx) =>
    trx.selectFrom("ledger").select("call_site").where("meeting_id", "=", m.meetingId).execute(),
  );
  expect(ledger.filter((row) => row.call_site === "speech")).toHaveLength(3);
  expect(ledger.filter((row) => row.call_site === "receipts")).toHaveLength(3);
  expect(briefsQueued(t)).toHaveLength(1);
  expect(t.pending.filter((job) => job.name === "meeting_step")).toHaveLength(0);
  expect(t.client.remaining()).toEqual({ speech: 0, receipts: 0, questionCheck: 0 });
});

it("R5.3-T2: 50 parallel promotions of one queued meeting start it once with one step row", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  expect(await claimSlot(m.meetingId, 0)).toBe("queued");
  const counts = await Promise.all(
    Array.from({ length: 50 }, () => promoteQueuedMeetings(slots(t.context, 40), [m.meetingId])),
  );
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
  expect(await stateOf(m.meetingId)).toBe("running");
  const steps = await withMeeting(workerDb, m.meetingId, (trx) =>
    trx.selectFrom("meeting_steps").select("id").where("meeting_id", "=", m.meetingId).execute(),
  );
  expect(steps).toHaveLength(1);
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "meeting.started"),
  ).toHaveLength(1);
  expect(t.pending.filter((job) => job.name === "meeting_step")).toHaveLength(1);
});

it("R5.4-T1: a step left running by a dead worker is marked stalled and re-enqueued by one sweep", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  t.pending.splice(
    t.pending.findIndex((job) => job.name === "meeting_step"),
    1,
  );
  await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
  // The dead worker claimed the step 7 minutes ago, past the 6 minutes a live runner keeps its
  // claim.
  await claimedAgo(m.meetingId, 420_000);
  await backdate(m.meetingId);
  await runMeetingJob(t, "sweep_stalled", {});
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "stalled", attempt: 1 });
  expect(t.pending.filter((job) => job.name === "meeting_step")).toEqual([
    { name: "meeting_step", payload: { meetingId: m.meetingId, stepSeq: 1 }, options: undefined },
  ]);
});

it("R12.4-T1: after that sweep the dead runner's late commit is refused and the new runner's turn lands once, using the drain", async () => {
  const t = await openTest({ speech: [text(S1)], receipts: [{ claims: [] }], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  t.pending.splice(
    t.pending.findIndex((job) => job.name === "meeting_step"),
    1,
  );
  await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
  // The dead worker claimed the step 7 minutes ago, past the 6 minutes a live runner keeps its
  // claim.
  await claimedAgo(m.meetingId, 420_000);
  await backdate(m.meetingId);
  await runMeetingJob(t, "sweep_stalled", {});
  await drainJobs(t, { limit: 1, names: ["meeting_step"] });
  const late = await commitTurn(t.context, {
    meetingId: m.meetingId,
    stepSeq: 1,
    side: "a",
    phase: "open",
    attempt: 1,
    personId: m.a.personId,
    cardId: m.a.cardId,
    text: "late text",
    requestsMade: 1,
    hasDecision: false,
    claims: [],
    toolCalls: [],
  });
  expect(late).toEqual({ kind: "lost" });
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "turn.committed"),
  ).toHaveLength(1);
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "done", attempt: 2 });
});

it("R5.8-T3: on a fake clock with 90 s per turn explore stops at 8 minutes, both decide turns run, and the meeting ends at 12 minutes, using the drain", async () => {
  const t = await openTest({
    speech: Array.from({ length: 9 }, () => text("A turn.")),
    receipts: Array.from({ length: 9 }, () => ({ claims: [] })),
    questionCheck: [],
  });
  await startTestMeeting(t, m.meetingId);
  await drainJobs(t, { limit: 20, names: ["meeting_step"], stepGapMs: 90_000 });
  const rows = await withMeeting(workerDb, m.meetingId, (trx) =>
    trx
      .selectFrom("meeting_steps")
      .select(["step_seq", "phase"])
      .where("meeting_id", "=", m.meetingId)
      .orderBy("step_seq")
      .execute(),
  );
  expect(rows.map((row) => row.phase)).toEqual([
    "open",
    "open",
    "explore",
    "explore",
    "explore",
    "explore",
    "explore",
    "decide",
    "decide",
  ]);
  const events = await eventsOf(m.meetingId);
  expect(
    events.flatMap((event) => (event.type === "phase.changed" ? [event.stepSeq] : [])),
  ).toEqual([1, 3, 8]);
  const holds = events.filter((event) => event.type === "hold");
  expect(events.flatMap((event) => (event.type === "hold" ? [event.stepSeq] : []))).toEqual([8, 9]);
  for (const hold of holds) expect(hold).toMatchObject({ reason: "no explicit decision" });
  const ended = events.find((event) => event.type === "meeting.ended");
  expect(ended).toMatchObject({ type: "meeting.ended", reason: "decided" });
  const started = events.find((event) => event.type === "meeting.started");
  if (ended?.type !== "meeting.ended" || started?.type !== "meeting.started")
    throw new Error("The meeting did not start and end.");
  const span = Date.parse(ended.endedAt) - Date.parse(started.startedAt);
  expect(span).toBeGreaterThanOrEqual(660_000);
  expect(span).toBeLessThanOrEqual(780_000);
});

it("D57-T1: the sweeper promotes the queued meeting with the lowest position when a slot frees, and only one", async () => {
  const y = await createPairedMeeting(fresh.db, { questionId: 3 });
  const z = await createPairedMeeting(fresh.db, { questionId: 3 });
  created.push(y.meetingId, z.meetingId);
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  for (const id of [m.meetingId, y.meetingId, z.meetingId])
    await runMeetingJob(t, "check_question", { meetingId: id });
  expect(await claimSlot(m.meetingId, 1)).toBe("running");
  await withMeeting(workerDb, m.meetingId, (trx) =>
    beginRunningMeeting(trx, m.meetingId, t.clock.now()),
  );
  expect(await claimSlot(y.meetingId, 1)).toBe("queued");
  expect(await claimSlot(z.meetingId, 1)).toBe("queued");
  await runSweepStalled({}, slots(t.context, 1));
  expect(await stateOf(y.meetingId)).toBe("queued");
  expect(await stateOf(z.meetingId)).toBe("queued");
  await withMeeting(workerDb, m.meetingId, (trx) =>
    endMeeting(trx, { meetingId: m.meetingId, reason: "decided", now: t.clock.now() }),
  );
  await runSweepStalled({}, slots(t.context, 1));
  expect(await stateOf(y.meetingId)).toBe("running");
  expect(await stepOf(y.meetingId, 1)).toMatchObject({ side: "a", phase: "open" });
  expect(
    (await eventsOf(y.meetingId)).filter((event) => event.type === "meeting.started"),
  ).toHaveLength(1);
  const zRow = await withMeeting(workerDb, z.meetingId, (trx) =>
    trx
      .selectFrom("meetings")
      .select(["state", "queue_position"])
      .where("id", "=", z.meetingId)
      .executeTakeFirstOrThrow(),
  );
  expect(zRow).toEqual({ state: "queued", queue_position: 2 });
});

it("D46-T1: each sweep writes the worker heartbeat with the schema version, using a fake clock", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await runMeetingJob(t, "sweep_stalled", {});
  const heartbeat = await workerDb
    .selectFrom("service_heartbeats")
    .select(["seen_at", "schema_version"])
    .where("service", "=", "worker")
    .executeTakeFirstOrThrow();
  expect(new Date(heartbeat.seen_at).getTime()).toBe(t.clock.now().getTime());
  expect(heartbeat.schema_version).toBe(SCHEMA_VERSION);
});

it("R5.10-T1: the sweeper ends a running meeting at the token stop and enqueues the briefs", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  await withMeeting(workerDb, m.meetingId, (trx) =>
    trx
      .insertInto("ledger")
      .values({
        meeting_id: m.meetingId,
        person_id: null,
        call_site: "speech",
        model: "muse-spark-1.3",
        effort: "low",
        est_tokens: 0,
        prompt_tokens: 1_500_000,
        completion_tokens: 0,
        status: "ok",
        llm_mode: "replay",
      })
      .execute(),
  );
  await runMeetingJob(t, "sweep_stalled", {});
  const meeting = await withMeeting(workerDb, m.meetingId, (trx) =>
    trx
      .selectFrom("meetings")
      .select(["state", "end_reason"])
      .where("id", "=", m.meetingId)
      .executeTakeFirstOrThrow(),
  );
  expect(meeting).toEqual({ state: "ended", end_reason: "budget" });
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "meeting.ended"),
  ).toHaveLength(1);
  expect(t.pending.filter((job) => job.name === "write_briefs")).toEqual([
    { name: "write_briefs", payload: { meetingId: m.meetingId }, options: undefined },
  ]);
});

it("D46-T2: startReadyMeetings starts a meeting ready on both sides and leaves one with a go-ahead missing", async () => {
  const y = await createPairedMeeting(fresh.db, { questionId: 3 });
  created.push(y.meetingId);
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await runMeetingJob(t, "check_question", { meetingId: m.meetingId });
  await runMeetingJob(t, "check_question", { meetingId: y.meetingId });
  const now = new Date();
  await withMeeting(workerDb, m.meetingId, (trx) =>
    trx
      .updateTable("meeting_members")
      .set({ ready_at: now })
      .where("meeting_id", "=", m.meetingId)
      .execute(),
  );
  await withMeeting(workerDb, y.meetingId, (trx) =>
    trx
      .updateTable("meeting_members")
      .set({ ready_at: now })
      .where("meeting_id", "=", y.meetingId)
      .where("side", "=", "a")
      .execute(),
  );
  expect(await startReadyMeetings(t.context, [m.meetingId, y.meetingId])).toBe(1);
  expect(await stateOf(m.meetingId)).toBe("running");
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ side: "a", phase: "open" });
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "meeting.started"),
  ).toHaveLength(1);
  expect(await stateOf(y.meetingId)).toBe("ready");
  const ysteps = await withMeeting(workerDb, y.meetingId, (trx) =>
    trx.selectFrom("meeting_steps").select("id").where("meeting_id", "=", y.meetingId).execute(),
  );
  expect(ySteps(ysteps)).toHaveLength(0);
  expect(t.pending.filter((job) => job.name === "meeting_step")).toEqual([
    { name: "meeting_step", payload: { meetingId: m.meetingId, stepSeq: 1 }, options: undefined },
  ]);
});

// The rows of a step query, returned as they came, so a check reads its length.
function ySteps<T>(rows: readonly T[]): readonly T[] {
  return rows;
}

it("W3-WORK-T1: the sweep ends a meeting whose current step is stalled at attempt 3 with reason budget, and enqueues the briefs once", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  t.pending.splice(0);
  for (let attempt = 1; attempt <= MEETING_STEP_MAX_ATTEMPTS; attempt += 1) {
    await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
    await withMeeting(workerDb, m.meetingId, (trx) =>
      releaseStep(trx, { meetingId: m.meetingId, stepSeq: 1, attempt }, "stalled"),
    );
  }
  await backdate(m.meetingId);
  await runMeetingJob(t, "sweep_stalled", {});
  await runMeetingJob(t, "sweep_stalled", {});
  expect(await endOf(m.meetingId)).toEqual({ state: "ended", end_reason: "budget" });
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "meeting.ended"),
  ).toHaveLength(1);
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "stalled", attempt: 3 });
  expect(t.pending).toEqual([
    { name: "write_briefs", payload: { meetingId: m.meetingId }, options: undefined },
  ]);
});

it("W3-WORK-T2: the sweep gives a silent meeting 1 minute past its end a new job, and ends it with reason budget once it is more than 2 minutes past, using a fake clock", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  t.pending.splice(0);
  t.clock.advance((await endsAtOf(m.meetingId)).getTime() + 60_000 - t.clock.now().getTime());
  await backdate(m.meetingId);
  await runMeetingJob(t, "sweep_stalled", {});
  expect(await stateOf(m.meetingId)).toBe("running");
  expect(t.pending).toEqual([
    { name: "meeting_step", payload: { meetingId: m.meetingId, stepSeq: 1 }, options: undefined },
  ]);
  t.pending.splice(0);
  t.clock.advance(MEETING_OVERTIME_GRACE_MS);
  await runMeetingJob(t, "sweep_stalled", {});
  expect(await endOf(m.meetingId)).toEqual({ state: "ended", end_reason: "budget" });
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "meeting.ended"),
  ).toHaveLength(1);
  expect(t.pending).toEqual([
    { name: "write_briefs", payload: { meetingId: m.meetingId }, options: undefined },
  ]);
});

it("W3-WORK-T3: the sweep leaves a running step claimed 1 minute ago to its runner, and stalls and re-enqueues one claimed 7 minutes ago", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  t.pending.splice(0);
  await withMeeting(workerDb, m.meetingId, (trx) => claimStep(trx, m.meetingId, 1));
  await backdate(m.meetingId);
  await claimedAgo(m.meetingId, 60_000);
  await runMeetingJob(t, "sweep_stalled", {});
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "running", attempt: 1 });
  expect(t.pending).toEqual([]);
  await claimedAgo(m.meetingId, 420_000);
  await runMeetingJob(t, "sweep_stalled", {});
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "stalled", attempt: 1 });
  expect(t.pending).toEqual([
    { name: "meeting_step", payload: { meetingId: m.meetingId, stepSeq: 1 }, options: undefined },
  ]);
});

it("W3-WORK-T4: a step whose token stop finds the meeting ended by another path in the meantime enqueues no briefs", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  t.pending.splice(0);
  await reachTokenStop(m.meetingId);
  // Another path ends the meeting and holds its row until the step's own end waits on it, then
  // commits.
  const isWritten = signal();
  const otherEnd = withMeeting(workerDb, m.meetingId, async (trx) => {
    await endMeeting(trx, { meetingId: m.meetingId, reason: "decided", now: t.clock.now() });
    const holder =
      (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx)).rows[0]?.pid ?? 0;
    isWritten.fire();
    await waitUntilBlockedBy(holder);
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  await isWritten.wait;
  await runMeetingJob(t, "meeting_step", { meetingId: m.meetingId, stepSeq: 1 });
  expect(await otherEnd).toBeUndefined();
  expect(await endOf(m.meetingId)).toEqual({ state: "ended", end_reason: "decided" });
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "meeting.ended"),
  ).toHaveLength(1);
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "stalled", attempt: 1 });
  expect(briefsQueued(t)).toHaveLength(0);
});

it("W3-WORK-T5: a step that hits the dollar cap after another path ended the meeting enqueues no briefs", async () => {
  const t = await openTest({ speech: [], receipts: [], questionCheck: [] });
  await startTestMeeting(t, m.meetingId);
  t.pending.splice(0);
  // A fake speech call: while it runs another path ends the meeting, then the call stops at the
  // daily cap.
  const capped: LlmClient = {
    ...t.client,
    stream: async () => {
      await withMeeting(workerDb, m.meetingId, (trx) =>
        endMeeting(trx, { meetingId: m.meetingId, reason: "decided", now: t.clock.now() }),
      );
      throw new CapReached("daily_cap_reached", "meetings are paused for today", 429);
    },
  };
  await runMeetingStep({ meetingId: m.meetingId, stepSeq: 1 }, { ...t.context, llm: capped });
  expect(await endOf(m.meetingId)).toEqual({ state: "ended", end_reason: "decided" });
  expect(
    (await eventsOf(m.meetingId)).filter((event) => event.type === "meeting.ended"),
  ).toHaveLength(1);
  expect(await stepOf(m.meetingId, 1)).toMatchObject({ state: "stalled", attempt: 1 });
  expect(briefsQueued(t)).toHaveLength(0);
});
