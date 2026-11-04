import {
  EVENT_VERSION,
  PollResponse,
  rowToEvent,
  type CommittedEvent,
  type MeetingState,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";

// The running step's partial text, as one stream needs it.
export type RunningPartial = { stepSeq: number; attempt: number; side: "a" | "b"; text: string };
// The reads and the one write a meeting stream makes, each in its own withPerson transaction as the
// viewer, so row security decides what comes back.
export type StreamReads = {
  readMembership: (personId: string, meetingId: string) => Promise<{ state: MeetingState } | null>;
  readEventsAfter: (
    personId: string,
    meetingId: string,
    afterSeq: number,
  ) => Promise<CommittedEvent[]>;
  readRunningPartial: (personId: string, meetingId: string) => Promise<RunningPartial | null>;
  touchPresence: (personId: string, meetingId: string) => Promise<void>;
};

// Builds the four functions over the api's database and clock.
export function makeStreamReads(deps: Pick<RouteDeps, "db" | "now">): StreamReads {
  return {
    readMembership: (personId, meetingId) =>
      withPerson(deps.db, personId, async (trx) => {
        const row = await trx
          .selectFrom("meeting_members")
          .innerJoin("meetings", "meetings.id", "meeting_members.meeting_id")
          .select("meetings.state")
          .where("meeting_members.meeting_id", "=", meetingId)
          .where("meeting_members.person_id", "=", personId)
          .executeTakeFirst();
        return row === undefined ? null : { state: row.state };
      }),
    readEventsAfter: (personId, meetingId, afterSeq) =>
      withPerson(deps.db, personId, async (trx) => {
        const rows = await trx
          .selectFrom("meeting_events")
          .selectAll()
          .where("meeting_id", "=", meetingId)
          .where("seq", ">", afterSeq)
          .orderBy("seq", "asc")
          .execute();
        return rows.map((row) => rowToEvent(row));
      }),
    readRunningPartial: (personId, meetingId) =>
      withPerson(deps.db, personId, async (trx) => {
        const row = await trx
          .selectFrom("meeting_steps")
          .select(["step_seq", "attempt", "side", "partial_text"])
          .where("meeting_id", "=", meetingId)
          .where("state", "=", "running")
          .orderBy("step_seq", "desc")
          .limit(1)
          .executeTakeFirst();
        if (row === undefined || row.partial_text === "") {
          return null;
        }
        return {
          stepSeq: row.step_seq,
          attempt: row.attempt,
          side: row.side,
          text: row.partial_text,
        };
      }),
    touchPresence: (personId, meetingId) =>
      withPerson(deps.db, personId, async (trx) => {
        await trx
          .updateTable("meeting_members")
          .set({ last_seen_at: deps.now() })
          .where("meeting_id", "=", meetingId)
          .where("person_id", "=", personId)
          .execute();
      }),
  };
}

// The ?after= poll body: the events after afterSeq, the running partial or null, and the server
// time.
export async function readPollResponse(
  reads: StreamReads,
  input: { personId: string; meetingId: string; afterSeq: number; now: Date },
): Promise<PollResponse> {
  const [events, partial] = await Promise.all([
    reads.readEventsAfter(input.personId, input.meetingId, input.afterSeq),
    reads.readRunningPartial(input.personId, input.meetingId),
  ]);
  return PollResponse.parse({
    v: EVENT_VERSION,
    events,
    partial,
    serverNow: input.now.toISOString(),
  });
}
