// One person in Explore as the caller sees them: the listing's public side and how the caller stands with its person, so the profile
// shows the right buttons. directory_profile (migration 0008) reads it in one call and never returns a person id.
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { ContractError, HTTP, ProfileView, routes, Uuid } from "@meet-first/contracts";
import { sampleFaceKey, withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of GET /api/directory/:id: a listing id. One that is not a uuid is not_found, so a bad id tells nothing.
const ListingParams = z.object({ id: Uuid });

// One row of directory_profile by its SQL names (migration 0009).
export type ProfileRow = {
  listing_id: string; display_name: string; line: string; open_to_romance: boolean; is_sample: boolean; items: unknown;
  friendship: string; request_id: string | null; pair_id: string | null; can_ask: boolean;
};

// The profile view of one directory_profile row.
export function toProfileView(row: ProfileRow): ProfileView {
  return ProfileView.parse({
    listingId: row.listing_id, displayName: row.display_name, line: row.line, openToRomance: row.open_to_romance, isSample: row.is_sample, items: row.items,
    photo: row.is_sample ? sampleFaceKey(row.display_name) : null,
    friendship: row.friendship, requestId: row.request_id, pairId: row.pair_id, canAsk: row.can_ask,
  });
}

// Registers GET /api/directory/:id: 200 ProfileView; 404 not_found for a bad id and listing_not_found for a listing Explore does not show. Never cached, because a request or an answer changes the buttons.
export function registerReadProfile(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.readProfile.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = ListingParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const row = await withPerson(deps.db, personId, async (trx) => {
      const result = await sql<ProfileRow>`SELECT listing_id, display_name, line, open_to_romance, is_sample, items, friendship, request_id, pair_id, can_ask FROM directory_profile(${params.data.id}::uuid)`.execute(trx);
      return result.rows[0];
    });
    if (row === undefined) throw new ContractError("listing_not_found", "This person is no longer in Explore.", HTTP.notFound);
    reply.header("cache-control", "no-store");
    return reply.code(200).send(toProfileView(row));
  });
}
