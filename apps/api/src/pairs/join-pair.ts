// POST /api/pairs/join: the invited person posts the token from the link's fragment.
// pairs_join is one conditional UPDATE that sets the joiner only when nobody joined yet, the pair is unexpired
// and the joiner is not the creator, so a second join, an expired invite and joining your own invite all find
// nothing and answer 409 pair_unavailable.
import type { FastifyInstance } from "fastify";
import { sql, type Kysely } from "kysely";
import { ContractError, HTTP, PairJoin, PairJoinResponse, routes } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { hashToken, requirePerson } from "../sessions/index.js";

// The sentence for an invite that was used, expired, or is the caller's own.
export const PAIR_UNAVAILABLE_SENTENCE =
  "This invite was already used, has expired, or is your own. Ask for a new link.";

// Joins the pair the token names as this person; null when pairs_join changed no row.
export async function joinPairByToken(
  db: Kysely<Database>,
  token: string,
  personId: string,
): Promise<string | null> {
  const result = await sql<{
    pair_id: string | null;
  }>`SELECT pairs_join(${hashToken(token)}, ${personId}) AS pair_id`.execute(db);
  return result.rows[0]?.pair_id ?? null;
}

// Registers POST /api/pairs/join: 200 {pairId}, or 409 pair_unavailable.
export function registerJoinPair(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.meetings.joinPair.path, async (request, reply) => {
    const personId = requirePerson(request);
    const body = PairJoin.parse(request.body);
    const pairId = await joinPairByToken(deps.db, body.token, personId);
    if (pairId === null) {
      throw new ContractError("pair_unavailable", PAIR_UNAVAILABLE_SENTENCE, HTTP.conflict);
    }
    return reply.code(200).send(PairJoinResponse.parse({ pairId }));
  });
}
