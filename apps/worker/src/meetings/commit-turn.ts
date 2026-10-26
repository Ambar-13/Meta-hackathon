import { sql, type Transaction } from "kysely";
import { Claim, CommittedEvent, ContractError, EVENT_VERSION, eventToPayload } from "@meet-first/contracts";
import { nextEventSeq, withMeeting, type Database } from "@meet-first/db";
import type { JobContext } from "../job-context.js";
import { nextStep, startsNewPhase, type StepPhase } from "./agenda.js";
import { StepOutput } from "./claim-step.js";
import type { StoredClaim } from "./receipts.js";
import { NO_DECISION_REASON } from "./tool-loop.js";

// A committed event's own fields: everything except the five the log adds (v, type, meetingId, seq, at).
export type EventFields<T extends CommittedEvent["type"]> = Omit<Extract<CommittedEvent, { type: T }>, "v" | "type" | "meetingId" | "seq" | "at">;
// One event to write: the meeting, its type, its own fields and the time it happened.
export type EventWrite<T extends CommittedEvent["type"]> = { meetingId: string; type: T; fields: EventFields<T>; at: Date };
// A turn ready to commit.
export type FinishedTurn = {
  meetingId: string; stepSeq: number; side: "a" | "b"; phase: StepPhase; attempt: number; personId: string; cardId: string;
  text: string; requestsMade: number; hasDecision: boolean; claims: StoredClaim[]; toolCalls: Array<{ name: string; arguments: string }>;
};
// How a commit ended: the next step exists, the meeting ended, or this runner had lost the step.
export type CommitResult = { kind: "next"; stepSeq: number } | { kind: "ended" } | { kind: "lost" };
// A claim after its row was written: the row id, the speaker's side, its position and whether its evidence is valid (D26, R6.4).
type StoredRow = { id: string; side: "a" | "b"; position: number; claim: StoredClaim; isEvidenceValid: boolean };

// Writes one committed event with the next gapless seq, after parsing the whole event with CommittedEvent (R5.11, invariant 11).
export async function appendMeetingEvent<T extends CommittedEvent["type"]>(trx: Transaction<Database>, write: EventWrite<T>): Promise<CommittedEvent> {
  const seq = await nextEventSeq(trx, write.meetingId);
  const event = CommittedEvent.parse({ ...write.fields, v: EVENT_VERSION, type: write.type, meetingId: write.meetingId, seq, at: write.at.toISOString() });
  await trx.insertInto("meeting_events").values({ meeting_id: event.meetingId, seq: event.seq, type: event.type, v: event.v, payload: JSON.stringify(eventToPayload(event)), created_at: event.at }).execute();
  return event;
}

// Starts a meeting that is ready on both sides (both go-aheads, the question checked, both prefixes stored) through claim_meeting_slot, with nobody online (D57).
export async function startIfReady(trx: Transaction<Database>, slot: { meetingId: string; now: Date; maxRunning: number }): Promise<"running" | "queued" | "not_ready"> {
  const meeting = await trx.selectFrom("meetings").select(["state", "question_checked_at", "question_rejected_reason"]).where("id", "=", slot.meetingId).forUpdate().executeTakeFirst();
  if (meeting === undefined || meeting.state !== "ready" || meeting.question_checked_at === null || meeting.question_rejected_reason !== null) return "not_ready";
  const members = await trx.selectFrom("meeting_members").select(["ready_at", "frozen_prefix"]).where("meeting_id", "=", slot.meetingId).execute();
  if (members.length !== 2 || members.some((member) => member.ready_at === null || member.frozen_prefix === null)) return "not_ready";
  const rows = (await claimSlot(trx, slot.meetingId, slot.maxRunning)).rows;
  const row = rows[0];
  if (row === undefined) return "not_ready";
  if (row.state !== "running") return "queued";
  await beginRunningMeeting(trx, slot.meetingId, slot.now);
  return "running";
}

// Begins a meeting that has won a running slot: phase open, step 1 pending for side a, meeting.started then phase.changed (ARCHITECTURE.md 4.1).
export async function beginRunningMeeting(trx: Transaction<Database>, meetingId: string, now: Date): Promise<void> {
  const meeting = await trx.selectFrom("meetings").select(["started_at", "ends_at", "question_text"]).where("id", "=", meetingId).executeTakeFirstOrThrow();
  await trx.updateTable("meetings").set({ phase: "open", current_step_seq: 1 }).where("id", "=", meetingId).execute();
  const members = await trx.selectFrom("meeting_members as mm").innerJoin("people as p", "p.id", "mm.person_id").select(["mm.side", "p.display_name"]).where("mm.meeting_id", "=", meetingId).orderBy("mm.side").execute();
  await trx.insertInto("meeting_steps").values({ meeting_id: meetingId, step_seq: 1, side: "a", phase: "open" }).execute();
  await appendMeetingEvent(trx, {
    meetingId, type: "meeting.started", at: now,
    fields: { startedAt: timeOf(meeting.started_at), endsAt: timeOf(meeting.ends_at), question: meeting.question_text, members: members.map((member) => ({ side: member.side, displayName: member.display_name })) },
  });
  await appendMeetingEvent(trx, { meetingId, type: "phase.changed", fields: { phase: "open", stepSeq: 1 }, at: now });
}

// Ends a running meeting with its reason and writes meeting.ended; false when the meeting was not running (D61, R5.8).
export async function endMeeting(trx: Transaction<Database>, end: { meetingId: string; reason: "decided" | "budget"; now: Date }): Promise<boolean> {
  const result = await trx.updateTable("meetings").set({ state: "ended", end_reason: end.reason, ended_at: end.now, phase: "close" })
    .where("id", "=", end.meetingId).where("state", "=", "running").executeTakeFirst();
  if (result.numUpdatedRows === 0n) return false;
  await appendMeetingEvent(trx, { meetingId: end.meetingId, type: "meeting.ended", fields: { reason: end.reason, endedAt: end.now.toISOString() }, at: end.now });
  return true;
}

// Commits a finished turn in one transaction, then enqueues the next step or the briefs (D44, R5.2, invariant 11).
export async function commitTurn(context: JobContext, turn: FinishedTurn): Promise<CommitResult> {
  const now = context.now();
  let result: CommitResult;
  try {
    result = await withMeeting(context.db, turn.meetingId, (trx) => writeTurn(trx, turn, now));
  } catch (error) {
    if (isLostStep(error)) return { kind: "lost" };
    throw error;
  }
  if (result.kind === "next") await context.enqueue("meeting_step", { meetingId: turn.meetingId, stepSeq: result.stepSeq });
  if (result.kind === "ended") await context.enqueue("write_briefs", { meetingId: turn.meetingId });
  return result;
}

// Runs the commit inside the meeting's transaction, in the order of the design: lock, mark the step, claims, hold, turn, next step.
async function writeTurn(trx: Transaction<Database>, turn: FinishedTurn, now: Date): Promise<CommitResult> {
  const startedAt = await lockRunningMeeting(trx, turn.meetingId);
  await markStepDone(trx, turn, now);
  const rows = await insertClaims(trx, turn);
  if (turn.phase === "decide" && !turn.hasDecision) {
    await appendMeetingEvent(trx, { meetingId: turn.meetingId, type: "hold", fields: { stepSeq: turn.stepSeq, side: turn.side, reason: NO_DECISION_REASON }, at: now });
  }
  await appendMeetingEvent(trx, { meetingId: turn.meetingId, type: "turn.committed", fields: { stepSeq: turn.stepSeq, side: turn.side, phase: turn.phase, text: turn.text, claims: rows.map(toClaim) }, at: now });
  return advance(trx, { turn, startedAt, now });
}

// Locks the meeting row and returns its start, or refuses when the meeting is no longer running (R9.6).
async function lockRunningMeeting(trx: Transaction<Database>, meetingId: string): Promise<Date> {
  const meeting = await trx.selectFrom("meetings").select(["state", "started_at"]).where("id", "=", meetingId).forUpdate().executeTakeFirst();
  if (meeting === undefined || meeting.state !== "running" || meeting.started_at === null) {
    throw new ContractError("meeting_not_running", "The meeting is no longer running, so this turn is not committed.", 409);
  }
  return meeting.started_at;
}

// Marks the step done with its output, only while this runner still holds it (D44).
async function markStepDone(trx: Transaction<Database>, turn: FinishedTurn, now: Date): Promise<void> {
  const output = StepOutput.parse({ text: turn.text, toolCalls: turn.toolCalls, claimsCommitted: turn.claims.length });
  const done = await trx.updateTable("meeting_steps")
    .set({ state: "done", output: JSON.stringify(output), finished_at: now, tool_rounds: turn.requestsMade, partial_text: turn.text, partial_len: turn.text.length })
    .where("meeting_id", "=", turn.meetingId).where("step_seq", "=", turn.stepSeq).where("attempt", "=", turn.attempt).where("state", "=", "running")
    .executeTakeFirst();
  if (done.numUpdatedRows !== 1n) throw new ContractError("step_claim_lost", "Another runner took over this step, so this runner stops without writing.", 409);
}

// Writes one claim row per claim, in list order, and records whether each claim's turn is behind an approved item or in the recall corpus (D26).
async function insertClaims(trx: Transaction<Database>, turn: FinishedTurn): Promise<StoredRow[]> {
  const evidence = await evidenceTurnIds(trx, turn);
  const rows: StoredRow[] = [];
  for (const [index, claim] of turn.claims.entries()) {
    const position = index + 1;
    const isEvidenceValid = evidence.has(claim.turnId);
    const inserted = await trx.insertInto("claims").values({
      meeting_id: turn.meetingId, step_seq: turn.stepSeq, side: turn.side, person_id: turn.personId, position, text: claim.text, quote: claim.quote,
      gloss: claim.gloss, lang: claim.lang, turn_id: claim.turnId, verified: claim.isVerified, flagged: !claim.isVerified, regenerated: claim.isRegenerated, evidence_valid: isEvidenceValid,
    }).returning("id").executeTakeFirstOrThrow();
    rows.push({ id: inserted.id, side: turn.side, position, claim, isEvidenceValid });
  }
  return rows;
}

// The turn ids a claim may rest on: the approved items of the speaker's card and the recall corpus of that card (ARCHITECTURE.md 3.18, 3.28).
async function evidenceTurnIds(trx: Transaction<Database>, turn: FinishedTurn): Promise<Set<string>> {
  const approved = await trx.selectFrom("card_items").select("turn_id").where("card_id", "=", turn.cardId).where("approved", "=", true).execute();
  if (turn.claims.length === 0) return new Set(approved.map((row) => row.turn_id));
  const corpus = await trx.selectFrom("recall_corpus").select("turn_id").where("card_id", "=", turn.cardId).where("turn_id", "in", turn.claims.map((claim) => claim.turnId)).execute();
  return new Set([...approved, ...corpus].map((row) => row.turn_id));
}

// Moves the meeting to the next step, or ends it when the agenda is done; writes phase.changed when a new phase starts.
async function advance(trx: Transaction<Database>, scope: { turn: FinishedTurn; startedAt: Date; now: Date }): Promise<CommitResult> {
  const { turn, startedAt, now } = scope;
  const phases = await trx.selectFrom("meeting_steps").select(["step_seq", "phase"]).where("meeting_id", "=", turn.meetingId).where("state", "=", "done").orderBy("step_seq").execute();
  const next = nextStep({ lastStepSeq: turn.stepSeq, phases: phases.map((row) => row.phase), startedAt }, now);
  if (next.kind === "end") {
    await endMeeting(trx, { meetingId: turn.meetingId, reason: "decided", now });
    return { kind: "ended" };
  }
  await trx.insertInto("meeting_steps").values({ meeting_id: turn.meetingId, step_seq: next.stepSeq, side: next.side, phase: next.phase }).execute();
  if (startsNewPhase(turn.phase, next)) {
    await appendMeetingEvent(trx, { meetingId: turn.meetingId, type: "phase.changed", fields: { phase: next.phase, stepSeq: next.stepSeq }, at: now });
  }
  await trx.updateTable("meetings").set({ current_step_seq: next.stepSeq, phase: next.phase }).where("id", "=", turn.meetingId).execute();
  return { kind: "next", stepSeq: next.stepSeq };
}

// The Claim event shape of one stored claim (R5.11).
function toClaim(row: StoredRow): Claim {
  const { claim } = row;
  return Claim.parse({
    id: row.id, side: row.side, position: row.position, text: claim.text, quote: claim.quote, lang: claim.lang,
    turnId: claim.turnId, verified: claim.isVerified, flagged: !claim.isVerified, evidenceValid: row.isEvidenceValid,
    ...(claim.gloss === "" ? {} : { gloss: claim.gloss }),
  });
}

// True for the two refusals that mean this runner lost the step or the meeting, so nothing is written.
function isLostStep(error: unknown): boolean {
  return error instanceof ContractError && (error.code === "step_claim_lost" || error.code === "meeting_not_running");
}

// An ISO time of a stored timestamp; a running meeting always has both times, so a missing one is a fault.
function timeOf(value: Date | null): string {
  if (value === null) throw new ContractError("meeting_times_missing", "A running meeting has no start or end time. Check the claim that started it.", 500);
  return value.toISOString();
}

// Claims the slot through claim_meeting_slot, the one function that counts running meetings (D57).
function claimSlot(trx: Transaction<Database>, meetingId: string, maxRunning: number) {
  return sql<{ state: string; queue_position: number | null }>`SELECT state, queue_position FROM claim_meeting_slot(${meetingId}, ${maxRunning})`.execute(trx);
}
