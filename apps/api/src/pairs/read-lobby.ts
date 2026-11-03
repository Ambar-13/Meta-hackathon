import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { PairView, routes } from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The meeting states in which a lobby poll counts as being present: a meeting that can still start, or runs.
export const PRESENCE_STATES = ["ready", "queued", "running"] as const;
// The :id parameter of the lobby poll. A value that is not a uuid is not_found, so it tells nothing; this schema is local because contracts has no params schemas.
export const PairParams = z.object({ id: z.string().uuid() });

// Stamps last_seen_at on the caller's member rows of this pair's meetings that are ready, queued or running.
export async function touchLobbyPresence(trx: Transaction<Database>, input: { personId: string; pairId: string; now: Date }): Promise<void> {
  await trx
    .updateTable("meeting_members")
    .set({ last_seen_at: input.now })
    .where("person_id", "=", input.personId)
    .where("meeting_id", "in", trx.selectFrom("meetings").select("meetings.id").where("meetings.pair_id", "=", input.pairId).where("meetings.state", "in", [...PRESENCE_STATES]))
    .execute();
}

// Reads the pair as the caller: both display names and its meetings, newest first; null when the caller is not in it.
// The other person's name comes only from pair_display_names, which returns no row unless the caller is in the pair.
export async function readPairView(trx: Transaction<Database>, input: { pairId: string; now: Date }): Promise<PairView | null> {
  const pair = await trx.selectFrom("pairs").select(["id", "creator_person_id", "joiner_person_id", "expires_at"]).where("id", "=", input.pairId).executeTakeFirst();
  if (pair === undefined) {
    return null;
  }
  const names = await sql<{ creator_display_name: string; joiner_display_name: string | null }>`SELECT creator_display_name, joiner_display_name FROM pair_display_names(${input.pairId}::uuid)`.execute(trx);
  const nameRow = names.rows[0];
  if (nameRow === undefined) {
    return null;
  }
  const meetings = await trx
    .selectFrom("meetings")
    .select(["id", "state", "question_text", "queue_position", "created_at"])
    .where("pair_id", "=", input.pairId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return PairView.parse({
    id: pair.id,
    creator: { displayName: nameRow.creator_display_name },
    ...(pair.joiner_person_id === null ? {} : { joiner: { displayName: nameRow.joiner_display_name ?? "" } }),
    meetings: meetings.map((meeting) => ({
      id: meeting.id,
      state: meeting.state,
      questionText: meeting.question_text,
      ...(meeting.queue_position === null ? {} : { queuePosition: meeting.queue_position }),
      createdAt: meeting.created_at.toISOString(),
    })),
    expiresAt: pair.expires_at.toISOString(),
    serverNow: input.now.toISOString(),
  });
}

// Registers GET /api/pairs/:id: 200 PairView as JSON, polled every 5 s by the lobby, never a stream.
export function registerReadLobby(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.meetings.readPair.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = PairParams.safeParse(request.params);
    if (!params.success) {
      throw makeNotFoundError();
    }
    const now = deps.now();
    const view = await withPerson(deps.db, personId, async (trx) => {
      await touchLobbyPresence(trx, { personId, pairId: params.data.id, now });
      return readPairView(trx, { pairId: params.data.id, now });
    });
    if (view === null) {
      throw makeNotFoundError();
    }
    return reply.code(200).send(view);
  });
}
