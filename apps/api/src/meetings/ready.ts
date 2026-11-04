import type { FastifyInstance } from "fastify";
import {
  ContractError,
  HTTP,
  MeetingReadyResponse,
  PRESENCE_WINDOW_SECONDS,
  routes,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { enqueueAfterStart, meetingIdOf, tryStart } from "./start.js";

// True when a member's last lobby poll or stream heartbeat is at most 30 s old: "watching now", shown only and never a condition to start.
export function isMemberConnected(lastSeenAt: Date | null, now: Date): boolean {
  return (
    lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= PRESENCE_WINDOW_SECONDS * 1000
  );
}

// Registers POST /api/meetings/:id/ready: 200 {ready: true}; 404 not_found; 409 meeting_already_started.
export function registerReady(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.meetings.ready.path, async (request, reply) => {
    const personId = requirePerson(request);
    const meetingId = meetingIdOf(request.params);
    const now = deps.now();
    const decision = await withPerson(deps.db, personId, async (trx) => {
      const meeting = await trx
        .selectFrom("meetings")
        .select("state")
        .where("id", "=", meetingId)
        .forUpdate()
        .executeTakeFirst();
      if (meeting === undefined) throw makeNotFoundError();
      if (meeting.state !== "ready") {
        throw new ContractError(
          "meeting_already_started",
          "This meeting has already started or ended, so there is nothing to get ready for.",
          HTTP.conflict,
        );
      }
      const updated = await trx
        .updateTable("meeting_members")
        .set({ ready_at: now })
        .where("meeting_id", "=", meetingId)
        .where("person_id", "=", personId)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) throw makeNotFoundError();
      return tryStart(trx, { meetingId, now, maxRunning: deps.env.MAX_CONCURRENT_MEETINGS });
    });
    await enqueueAfterStart(deps, meetingId, decision);
    return reply.send(MeetingReadyResponse.parse({ ready: true }));
  });
}
