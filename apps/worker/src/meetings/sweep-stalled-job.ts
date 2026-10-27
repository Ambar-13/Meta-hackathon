import { sql, type Kysely, type Transaction } from "kysely";
import { SWEEP_STALLED_SECONDS } from "@meet-first/contracts";
import { SCHEMA_VERSION, withMeeting, type Database } from "@meet-first/db";
import { readMeetingTokens } from "@meet-first/llm";
import type { JobContext, JobTask } from "../job-context.js";
import { isOverTokenStop } from "./agenda.js";
import { releaseStep } from "./claim-step.js";
import { beginRunningMeeting, endMeeting, startIfReady } from "./commit-turn.js";

// The claims a meeting step gets. Once the current step is stalled at this attempt, the sweep ends the meeting with reason budget
// instead of enqueueing the step again, so a turn that keeps failing after its model calls stops paying for them (claimStep adds 1
// to the attempt on every claim).
export const MEETING_STEP_MAX_ATTEMPTS = 3;
// How long past its ends_at a stalled meeting may go on before the sweep ends it with reason budget: 2 minutes, room for the decide
// turns that begin near the end (D34, R5.8).
export const MEETING_OVERTIME_GRACE_MS = 120_000;
// How long a running step belongs to the runner that claimed it: the sweep does not stall a running step claimed less than 6 minutes
// ago, because a slow but healthy step (a long reasoning call, two receipts calls) would get a second runner that pays again.
export const STEP_CLAIM_FRESH_MS = 360_000;

// The four kinds sweep_candidates returns, in the order the sweep handles them.
const KINDS = ["stalled", "queued", "running", "ready"] as const;
// One of the four kinds.
type Kind = (typeof KINDS)[number];
// The meetings the sweep must look at, by kind, each id once, in the order sweep_candidates returned them.
export type SweepCandidates = Record<Kind, string[]>;
// The outcome of one promotion attempt: it started the meeting, or every slot is taken.
type PromoteOutcome = "started" | "full";
// What the sweep reads of a silent meeting's current step: its state, how many times it was claimed, and when it was last claimed.
export type SweptStep = { state: "pending" | "running" | "stalled" | "done"; attempt: number; claimedAt: Date | null };
// What the sweep does with a silent meeting: leave its step alone, give the step a new job, or end the meeting with reason budget.
export type StallAction = "skip" | "enqueue" | "end";
// What the transaction of one silent meeting did: nothing, a new job is due for this step, or it ended the meeting.
type StalledOutcome = { kind: "skipped" } | { kind: "enqueued"; stepSeq: number } | { kind: "ended" };

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

// Handles the current step of a meeting with no event for 150 s (D46, R5.4): a running step whose claim is stale goes stalled, then
// the step gets a new job, or the meeting ends with reason budget; the briefs are queued only when this sweep's end ended the meeting.
export async function resumeStalledMeeting(context: JobContext, meetingId: string): Promise<"enqueued" | "skipped" | "ended"> {
  const outcome = await withMeeting(context.db, meetingId, (trx) => sweepStalledInside(trx, meetingId, context.now()));
  if (outcome.kind === "enqueued") await context.enqueue("meeting_step", { meetingId, stepSeq: outcome.stepSeq });
  if (outcome.kind === "ended") await context.enqueue("write_briefs", { meetingId });
  return outcome.kind;
}

// What the sweep does with a silent running meeting, in this order: more than MEETING_OVERTIME_GRACE_MS past ends_at, it ends; a
// done or missing step is left alone; a running step claimed less than STEP_CLAIM_FRESH_MS ago is left to its runner; a stalled or
// stale running step at MEETING_STEP_MAX_ATTEMPTS ends the meeting; anything else, a pending step among them, gets a new job.
export function stallAction(seen: { endsAt: Date | null; step: SweptStep | undefined }, now: Date): StallAction {
  const { endsAt, step } = seen;
  if (endsAt !== null && now.getTime() - endsAt.getTime() > MEETING_OVERTIME_GRACE_MS) return "end";
  if (step === undefined || step.state === "done") return "skip";
  if (step.state === "running" && isClaimFresh(step.claimedAt, now)) return "skip";
  if (step.state !== "pending" && step.attempt >= MEETING_STEP_MAX_ATTEMPTS) return "end";
  return "enqueue";
}

// The writes for one silent meeting, inside its transaction: read the meeting and its current step, mark a stale running step
// stalled, then end the meeting through endMeeting or hand the step on, as stallAction decides.
async function sweepStalledInside(trx: Transaction<Database>, meetingId: string, now: Date): Promise<StalledOutcome> {
  const meeting = await trx.selectFrom("meetings").select(["state", "current_step_seq", "ends_at"]).where("id", "=", meetingId).executeTakeFirst();
  if (meeting === undefined || meeting.state !== "running") return { kind: "skipped" };
  const stepSeq = meeting.current_step_seq;
  const step = await readSweptStep(trx, meetingId, stepSeq);
  const action = stallAction({ endsAt: meeting.ends_at, step }, now);
  if (action === "skip") return { kind: "skipped" };
  if (isStaleRunning(step, now)) await releaseStep(trx, { meetingId, stepSeq, attempt: step.attempt }, "stalled");
  if (action === "enqueue") return { kind: "enqueued", stepSeq };
  const isEnded = await endMeeting(trx, { meetingId, reason: "budget", now });
  return isEnded ? { kind: "ended" } : { kind: "skipped" };
}

// The current step of a meeting as the sweep reads it, or undefined when the row is missing.
async function readSweptStep(trx: Transaction<Database>, meetingId: string, stepSeq: number): Promise<SweptStep | undefined> {
  const row = await trx.selectFrom("meeting_steps").select(["state", "attempt", "claimed_at"]).where("meeting_id", "=", meetingId).where("step_seq", "=", stepSeq).executeTakeFirst();
  return row === undefined ? undefined : { state: row.state, attempt: row.attempt, claimedAt: row.claimed_at };
}

// True when a step was claimed less than STEP_CLAIM_FRESH_MS before now, so its runner may still be working.
function isClaimFresh(claimedAt: Date | null, now: Date): boolean {
  return claimedAt !== null && now.getTime() - claimedAt.getTime() < STEP_CLAIM_FRESH_MS;
}

// True when a step is running on a claim older than STEP_CLAIM_FRESH_MS, the mark of a runner that died, so the sweep stalls it.
function isStaleRunning(step: SweptStep | undefined, now: Date): step is SweptStep {
  return step !== undefined && step.state === "running" && !isClaimFresh(step.claimedAt, now);
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
