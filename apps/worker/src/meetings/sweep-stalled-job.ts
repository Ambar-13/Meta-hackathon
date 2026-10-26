import { sql, type Kysely } from "kysely";
import { SWEEP_STALLED_SECONDS } from "@meet-first/contracts";
import { SCHEMA_VERSION, withMeeting, type Database } from "@meet-first/db";
import { readMeetingTokens } from "@meet-first/llm";
import type { JobContext, JobTask } from "../job-context.js";
import { isOverTokenStop } from "./agenda.js";
import { releaseStep } from "./claim-step.js";
import { beginRunningMeeting, endMeeting, startIfReady } from "./commit-turn.js";

// The four kinds sweep_candidates returns, in the order the sweep handles them.
const KINDS = ["stalled", "queued", "running", "ready"] as const;
// One of the four kinds.
type Kind = (typeof KINDS)[number];
// The meetings the sweep must look at, by kind, each id once, in the order sweep_candidates returned them.
export type SweepCandidates = Record<Kind, string[]>;
// The outcome of one promotion attempt: it started the meeting, or every slot is taken.
type PromoteOutcome = "started" | "full";

// The sweep_stalled job: heartbeat, token stop, stalled steps, queue promotion, ready starts, in that order (D46).
export const runSweepStalled: JobTask<"sweep_stalled"> = async (payload, context) => {
  const now = context.now();
  await writeHeartbeat(context.db, now);
  const candidates = await readSweepCandidates(context.db);
  const ended = new Set<string>();
  for (const meetingId of candidates.running) {
    if (await guarded(context, meetingId, () => stopOverBudget(context, meetingId))) ended.add(meetingId);
  }
  for (const meetingId of candidates.stalled) {
    if (!ended.has(meetingId)) await guarded(context, meetingId, () => resumeStalledMeeting(context, meetingId));
  }
  await promoteQueuedMeetings(context, candidates.queued);
  await startReadyMeetings(context, candidates.ready);
};

// Writes the worker heartbeat /api/health reads; the table has no person or meeting column, so no context is set (ARCHITECTURE.md 3.25).
export async function writeHeartbeat(db: Kysely<Database>, now: Date): Promise<void> {
  await db.updateTable("service_heartbeats").set({ seen_at: now, schema_version: SCHEMA_VERSION }).where("service", "=", "worker").execute();
}

// The meetings sweep_candidates returns, by kind, each id once, in the order returned: queued ones lowest queue position first (docs/contracts.md section 6a).
export async function readSweepCandidates(db: Kysely<Database>): Promise<SweepCandidates> {
  const rows = (await sql<{ meeting_id: string; kind: string; queue_position: number | null }>`SELECT meeting_id, kind, queue_position FROM sweep_candidates(${SWEEP_STALLED_SECONDS})`.execute(db)).rows;
  const candidates: SweepCandidates = { stalled: [], queued: [], running: [], ready: [] };
  for (const row of rows) {
    if (!isKind(row.kind)) continue;
    if (!candidates[row.kind].includes(row.meeting_id)) candidates[row.kind].push(row.meeting_id);
  }
  return candidates;
}

// Ends a running meeting whose ledger tokens reached 1,500,000, so one meeting cannot burn the day (D61, R5.10); true when it ended it.
export async function stopOverBudget(context: JobContext, meetingId: string): Promise<boolean> {
  const isEnded = await withMeeting(context.db, meetingId, async (trx) => {
    const tokens = await readMeetingTokens(trx, meetingId);
    if (!isOverTokenStop(tokens)) return false;
    return endMeeting(trx, { meetingId, reason: "budget", now: context.now() });
  });
  if (isEnded) await context.enqueue("write_briefs", { meetingId });
  return isEnded;
}

// Re-queues the current step of a meeting with no event for 150 s: a running step goes stalled, a pending or stalled one is enqueued (D46, R5.4).
export async function resumeStalledMeeting(context: JobContext, meetingId: string): Promise<"enqueued" | "skipped"> {
  const stepSeq = await withMeeting(context.db, meetingId, async (trx) => {
    const meeting = await trx.selectFrom("meetings").select(["state", "current_step_seq"]).where("id", "=", meetingId).executeTakeFirst();
    if (meeting === undefined || meeting.state !== "running") return undefined;
    const step = await trx.selectFrom("meeting_steps").select(["state", "attempt"]).where("meeting_id", "=", meetingId).where("step_seq", "=", meeting.current_step_seq).executeTakeFirst();
    if (step === undefined || step.state === "done") return undefined;
    if (step.state === "running") await releaseStep(trx, { meetingId, stepSeq: meeting.current_step_seq, attempt: step.attempt }, "stalled");
    return meeting.current_step_seq;
  });
  if (stepSeq === undefined) return "skipped";
  await context.enqueue("meeting_step", { meetingId, stepSeq });
  return "enqueued";
}

// Promotes queued meetings in queue_position order while claim_meeting_slot finds a free slot (D57, R5.9); returns how many started.
export async function promoteQueuedMeetings(context: JobContext, meetingIds: readonly string[]): Promise<number> {
  let started = 0;
  for (const meetingId of meetingIds) {
    const outcome = await guarded(context, meetingId, () => promoteOne(context, meetingId));
    if (outcome === "full") break;
    if (outcome === "started") started += 1;
  }
  return started;
}

// Starts each meeting that is ready on both sides with its prefixes stored, so nobody has to press start (as-built item 28); returns how many started running.
export async function startReadyMeetings(context: JobContext, meetingIds: readonly string[]): Promise<number> {
  let started = 0;
  const now = context.now();
  for (const meetingId of meetingIds) {
    const outcome = await guarded(context, meetingId, () => startOne(context, meetingId, now));
    if (outcome === "started") started += 1;
  }
  return started;
}

// Claims one slot for a queued meeting and begins it; a full slot table gives "full".
async function promoteOne(context: JobContext, meetingId: string): Promise<PromoteOutcome> {
  const now = context.now();
  const isWon = await withMeeting(context.db, meetingId, async (trx) => {
    const rows = (await sql<{ state: string; queue_position: number | null }>`SELECT state, queue_position FROM claim_meeting_slot(${meetingId}, ${context.env.MAX_CONCURRENT_MEETINGS})`.execute(trx)).rows;
    if (rows[0]?.state !== "running") return false;
    await beginRunningMeeting(trx, meetingId, now);
    return true;
  });
  if (!isWon) return "full";
  await context.enqueue("meeting_step", { meetingId, stepSeq: 1 });
  return "started";
}

// Starts one ready meeting through startIfReady, in its own transaction.
async function startOne(context: JobContext, meetingId: string, now: Date): Promise<"started" | "not_started"> {
  const result = await withMeeting(context.db, meetingId, (trx) => startIfReady(trx, { meetingId, now, maxRunning: context.env.MAX_CONCURRENT_MEETINGS }));
  if (result !== "running") return "not_started";
  await context.enqueue("meeting_step", { meetingId, stepSeq: 1 });
  return "started";
}

// Runs one meeting's sweep step; a failure is logged with the meeting id and the sweep goes on (undefined).
async function guarded<T>(context: JobContext, meetingId: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch {
    context.log.warn({ code: "sweep_meeting_failed", meetingId }, "One meeting failed in the sweep, and the sweep goes on.");
    return undefined;
  }
}

// True when a value is one of the four kinds.
function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}
