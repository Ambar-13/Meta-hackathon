import type { FastifyInstance } from "fastify";
import { MeetingView, routes } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { isMemberConnected } from "./ready.js";
import { meetingIdOf, readMemberNames } from "./start.js";

// The meeting row fields the view reads.
export type MeetingViewRow = { id: string; state: string; phase: string | null; question_text: string; question_kind: string; question_checked_at: Date | null; started_at: Date | null; ends_at: Date | null; queue_position: number | null };
// One member row as the view reads it; the name comes from readMemberNames, not from people.
export type MemberViewRow = { side: "a" | "b"; person_id: string; ready_at: Date | null; last_seen_at: Date | null };

// Shapes the MeetingView: members in side order with their names, connected when seen within 30 s (watching now, shown only), the caller's side, optional fields left out when null.
export function toMeetingView(meeting: MeetingViewRow, people: { members: readonly MemberViewRow[]; names: { a: string; b: string }; viewerPersonId: string }, now: Date): MeetingView {
  const viewer = people.members.find((member) => member.person_id === people.viewerPersonId);
  if (viewer === undefined) throw makeNotFoundError();
  const members = [...people.members]
    .sort((left, right) => left.side.localeCompare(right.side))
    .map((member) => ({ side: member.side, displayName: people.names[member.side], ready: member.ready_at !== null, connected: isMemberConnected(member.last_seen_at, now) }));
  return MeetingView.parse({
    id: meeting.id,
    state: meeting.state,
    ...(meeting.phase === null ? {} : { phase: meeting.phase }),
    questionText: meeting.question_text,
    questionKind: meeting.question_kind,
    questionChecked: meeting.question_checked_at !== null,
    members,
    viewerSide: viewer.side,
    ...(meeting.started_at === null ? {} : { startedAt: meeting.started_at.toISOString() }),
    ...(meeting.ends_at === null ? {} : { endsAt: meeting.ends_at.toISOString() }),
    ...(meeting.queue_position === null ? {} : { queuePosition: meeting.queue_position }),
    serverNow: now.toISOString(),
  });
}

// Registers GET /api/meetings/:id: 200 MeetingView; 404 not_found.
export function registerReadMeeting(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.meetings.readMeeting.path, async (request, reply) => {
    const personId = requirePerson(request);
    const meetingId = meetingIdOf(request.params);
    const view = await withPerson(deps.db, personId, async (trx) => {
      const meeting = await trx.selectFrom("meetings")
        .select(["id", "state", "phase", "question_text", "question_kind", "question_checked_at", "started_at", "ends_at", "queue_position"])
        .where("id", "=", meetingId).executeTakeFirst();
      if (meeting === undefined) throw makeNotFoundError();
      const members = await trx.selectFrom("meeting_members").select(["side", "person_id", "ready_at", "last_seen_at"]).where("meeting_id", "=", meetingId).execute();
      const names = await readMemberNames(trx, meetingId);
      return toMeetingView(meeting, { members, names, viewerPersonId: personId }, deps.now());
    });
    return reply.send(view);
  });
}
