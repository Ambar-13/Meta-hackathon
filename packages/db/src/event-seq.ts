import { sql, type Transaction } from "kysely";
import { ContractError, eventToPayload, type CommittedEvent, type MeetingEvent } from "@meet-first/contracts";
import { numberFromPostgres } from "./client.js";
import type { Database } from "./types.js";

// A meeting event as a writer builds it before its seq is chosen: every variant of MeetingEvent without its seq field.
export type EventWithoutSeq = MeetingEvent extends infer E ? (E extends unknown ? Omit<E, "seq"> : never) : never;

// The next seq of a meeting's event log, read after locking the meeting row so two writers in one meeting take turns (invariant 11, D52).
export async function nextEventSeq(trx: Transaction<Database>, meetingId: string): Promise<number> {
  const meeting = await trx.selectFrom("meetings").select("id").where("id", "=", meetingId).forUpdate().executeTakeFirst();
  if (meeting === undefined) throw new ContractError("not_found", "This no longer exists or is not yours.", 404);
  const result = await sql<{ seq: number }>`SELECT coalesce(max(seq), 0) + 1 AS seq FROM meeting_events WHERE meeting_id = ${meetingId}`.execute(trx);
  return numberFromPostgres(result.rows[0]?.seq);
}

// Writes one committed event at the next seq, with the event's own version and time, and returns the seq it used (invariant 11, R5.11).
export async function appendMeetingEvent(trx: Transaction<Database>, meetingId: string, event: EventWithoutSeq): Promise<number> {
  if (event.type === "turn.delta") {
    throw new ContractError("event_type_unknown", `${event.type} is not a committed event type. Use a name from packages/contracts meetings/events.ts.`, 500);
  }
  const seq = await nextEventSeq(trx, meetingId);
  const committed: CommittedEvent = { ...event, seq };
  await trx.insertInto("meeting_events").values({ meeting_id: meetingId, seq, type: committed.type, v: committed.v, payload: JSON.stringify(eventToPayload(committed)), created_at: new Date(committed.at) }).execute();
  return seq;
}
