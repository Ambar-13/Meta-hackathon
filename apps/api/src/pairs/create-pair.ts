// POST /api/pairs (D32): a person makes an invite for one other person. The token is 128 random bits; only its
// sha256 is stored, it works once, and it expires 24 hours after it is made. The link carries the token after "#",
// so it never reaches a server log; the web app shows the link as a QR code (Wave 0 section 4.4.9) [confirm].
import type { FastifyInstance } from "fastify";
import { PAIR_LIFETIME_HOURS, PAIR_TOKEN_BYTES, PairCreateResponse, routes } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { appOrigin, hashToken, newHexToken, requirePerson } from "../sessions/index.js";

// The client path that joins a pair (seams S11, APP_PATHS.join).
export const PAIR_JOIN_PATH = "/join";

// The invite link: APP_ORIGIN, the join path, and the token after "#" (Wave 0 section 4.4.9).
export function inviteUrl(appOriginValue: string, token: string): string {
  return `${appOrigin(appOriginValue)}${PAIR_JOIN_PATH}#${token}`;
}

// Registers POST /api/pairs: 201 {pairId, inviteUrl, expiresAt} (D32).
export function registerCreatePair(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.meetings.createPair.path, async (request, reply) => {
    const personId = requirePerson(request);
    // No input caps invites per person; purge_expired removes an unjoined pair after its 24 hours (D32).
    const token = newHexToken(PAIR_TOKEN_BYTES);
    const expiresAt = new Date(deps.now().getTime() + PAIR_LIFETIME_HOURS * 3_600_000);
    const row = await withPerson(deps.db, personId, (trx) =>
      trx.insertInto("pairs").values({ creator_person_id: personId, token_hash: hashToken(token), expires_at: expiresAt }).returning("id").executeTakeFirstOrThrow(),
    );
    return reply.code(201).send(PairCreateResponse.parse({ pairId: row.id, inviteUrl: inviteUrl(deps.env.APP_ORIGIN, token), expiresAt: expiresAt.toISOString() }));
  });
}
