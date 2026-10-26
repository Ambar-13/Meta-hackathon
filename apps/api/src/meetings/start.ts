import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { CommittedEvent, ContractError, EVENT_VERSION, eventToPayload, HTTP, MeetingStartResponse, routes, Uuid } from "@meet-first/contracts";
import { nextEventSeq, withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The reasons a start is refused, in the order they are checked, each with its sentence (409, R10.5, D41; presence is not one, as-built item 28).
export const START_REFUSALS = {
  meeting_already_started: "This meeting has already started or ended.",
  question_rejected: "The question was not accepted, so this meeting cannot start. Create a meeting with another question.",
  question_not_checked: "The question is still being checked. Try again in a few seconds.",
  meeting_not_ready: "Both people need to give their go-ahead before the meeting can start.",
  meeting_preparing: "The meeting is still being prepared. Try again in a few seconds.",   // [confirm]: not in IMPLEMENTATION.md 2.2; the prefixes must exist before running (D41)
} as const;
// One start refusal code.
export type StartRefusal = keyof typeof START_REFUSALS;
// What one start attempt decided, inside its transaction; the caller acts on it after the commit.
export type StartDecision = { kind: "refused"; refusal: StartRefusal } | { kind: "running" } | { kind: "queued"; queuePosition: number };
// The :id of a meeting route: a uuid, or the meeting cannot exist.
const MeetingParams = z.object({ id: Uuid });

// Reads the meeting id from a route's params; anything that is not a uuid is not_found.
export function meetingIdOf(params: unknown): string {
  const parsed = MeetingParams.safeParse(params);
  if (!parsed.success) throw makeNotFoundError();
  return parsed.data.id;
}

// The first refusal for this meeting and its two members, or null when it may start (pure, so the order is tested).
export function startRefusal(meeting: { state: string; question_checked_at: Date | null; question_rejected_reason: string | null }, members: ReadonlyArray<{ ready_at: Date | null; frozen_prefix_tokens: number | null }>): StartRefusal | null {
  if (meeting.state !== "ready") return "meeting_already_started";
  if (meeting.question_rejected_reason !== null) return "question_rejected";
  if (meeting.question_checked_at === null) return "question_not_checked";
  if (members.length !== 2 || members.some((member) => member.ready_at === null)) return "meeting_not_ready";
  if (members.some((member) => member.frozen_prefix_tokens === null)) return "meeting_preparing";
  return null;
}

// Locks the meeting row, checks the start rule and, when it holds, claims a slot and begins the meeting (R5.3, D57).
export async function tryStart(trx: Transaction<Database>, attempt: { meetingId: string; now: Date; maxRunning: number }): Promise<StartDecision> {
  const { meetingId, now, maxRunning } = attempt;
  const meeting = await trx.selectFrom("meetings").select(["state", "question_checked_at", "question_rejected_reason"]).where("id", "=", meetingId).forUpdate().executeTakeFirst();
  if (meeting === undefined) throw makeNotFoundError();
  const members = await trx.selectFrom("meeting_members").select(["ready_at", "frozen_prefix_tokens"]).where("meeting_id", "=", meetingId).execute();
  const refusal = startRefusal(meeting, members);
  if (refusal !== null) return { kind: "refused", refusal };
  const row = (await sql<{ state: string; queue_position: number | null }>`SELECT state, queue_position FROM claim_meeting_slot(${meetingId}, ${maxRunning})`.execute(trx)).rows[0];
  if (row === undefined) return { kind: "refused", refusal: "meeting_already_started" };
  if (row.state === "running") {
    await beginRunningMeeting(trx, meetingId, now);
    return { kind: "running" };
  }
  return { kind: "queued", queuePosition: row.queue_position ?? 0 };
}

// After the commit: enqueues step 1 of a meeting that started, or check_question again for one still preparing.
export async function enqueueAfterStart(deps: RouteDeps, meetingId: string, decision: StartDecision): Promise<void> {
  if (decision.kind === "running") {
    await deps.enqueue("meeting_step", { meetingId, stepSeq: 1 });
    return;
  }
  if (decision.kind === "refused" && decision.refusal === "meeting_preparing") {
    await deps.enqueue("check_question", { meetingId });
  }
}

// The display names of both sides of a meeting, read through pair_display_names, because a person cannot read the other person's people row (docs/contracts.md section 6a).
export async function readMemberNames(trx: Transaction<Database>, meetingId: string): Promise<{ a: string; b: string }> {
  const meeting = await trx.selectFrom("meetings").select("pair_id").where("id", "=", meetingId).executeTakeFirst();
  if (meeting === undefined) throw namesMissing();
  const pair = await trx.selectFrom("pairs").select("creator_person_id").where("id", "=", meeting.pair_id).executeTakeFirst();
  if (pair === undefined) throw namesMissing();
  const members = await trx.selectFrom("meeting_members").select(["side", "person_id"]).where("meeting_id", "=", meetingId).execute();
  if (members.length !== 2) throw namesMissing();
  const names = (await sql<{ creator_display_name: string; joiner_display_name: string | null }>`SELECT * FROM pair_display_names(${meeting.pair_id})`.execute(trx)).rows[0];
  if (names === undefined || names.joiner_display_name === null) throw namesMissing();
  const nameOf = (personId: string): string => (personId === pair.creator_person_id ? names.creator_display_name : names.joiner_display_name ?? "");
  const sideName = (side: "a" | "b"): string => nameOf(members.find((member) => member.side === side)?.person_id ?? "");
  return { a: sideName("a"), b: sideName("b") };
}

// Writes one committed event with the next gapless seq after parsing it with CommittedEvent; the api's copy of the worker's appendMeetingEvent (R5.11).
export async function appendApiMeetingEvent(trx: Transaction<Database>, write: { meetingId: string; type: CommittedEvent["type"]; fields: Record<string, unknown>; at: Date }): Promise<void> {
  const seq = await nextEventSeq(trx, write.meetingId);
  const event = CommittedEvent.parse({ ...write.fields, v: EVENT_VERSION, type: write.type, meetingId: write.meetingId, seq, at: write.at.toISOString() });
  await trx.insertInto("meeting_events").values({ meeting_id: event.meetingId, seq: event.seq, type: event.type, v: event.v, payload: JSON.stringify(eventToPayload(event)), created_at: event.at }).execute();
}

// Begins a meeting that won its slot: phase open, step 1 pending for side a, meeting.started, phase.changed; the api's copy of the worker's beginRunningMeeting.
export async function beginRunningMeeting(trx: Transaction<Database>, meetingId: string, now: Date): Promise<void> {
  const meeting = await trx.selectFrom("meetings").select(["started_at", "ends_at", "question_text"]).where("id", "=", meetingId).executeTakeFirstOrThrow();
  await trx.updateTable("meetings").set({ phase: "open", current_step_seq: 1 }).where("id", "=", meetingId).execute();
  const names = await readMemberNames(trx, meetingId);
  await trx.insertInto("meeting_steps").values({ meeting_id: meetingId, step_seq: 1, side: "a", phase: "open" }).execute();
  await appendApiMeetingEvent(trx, {
    meetingId, type: "meeting.started", at: now,
    fields: { startedAt: isoOf(meeting.started_at), endsAt: isoOf(meeting.ends_at), question: meeting.question_text, members: [{ side: "a", displayName: names.a }, { side: "b", displayName: names.b }] },
  });
  await appendApiMeetingEvent(trx, { meetingId, type: "phase.changed", fields: { phase: "open", stepSeq: 1 }, at: now });
}

// Registers POST /api/meetings/:id/start: 200 {state: "running"} or {state: "queued", queuePosition}; 404; 409 with a START_REFUSALS code.
export function registerStart(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.meetings.start.path, async (request, reply) => {
    const personId = requirePerson(request);
    const meetingId = meetingIdOf(request.params);
    const now = deps.now();
    const decision = await withPerson(deps.db, personId, (trx) => tryStart(trx, { meetingId, now, maxRunning: deps.env.MAX_CONCURRENT_MEETINGS }));
    await enqueueAfterStart(deps, meetingId, decision);
    if (decision.kind === "refused") throw new ContractError(decision.refusal, START_REFUSALS[decision.refusal], HTTP.conflict);
    if (decision.kind === "queued") return reply.send(MeetingStartResponse.parse({ state: "queued", queuePosition: decision.queuePosition }));
    return reply.send(MeetingStartResponse.parse({ state: "running" }));
  });
}

// An ISO time of a stored timestamp; a running meeting always has both times, so a missing one is a fault.
function isoOf(value: Date | null): string {
  if (value === null) throw new ContractError("meeting_times_missing", "A running meeting has no start or end time. Check the claim that started it.", HTTP.internal);
  return value.toISOString();
}

// The error for a meeting whose two names cannot be read.
function namesMissing(): ContractError {
  return new ContractError("pair_names_missing", "The names of this meeting could not be read. Reload the page and try again.", HTTP.internal);
}
