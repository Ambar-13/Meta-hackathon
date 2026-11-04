// POST /api/sessions/claim: the second browser posts the token from the link's fragment and gets its own
// session cookie. auth_claim_transfer spends the link in one conditional UPDATE, so a second claim finds nothing,
// and it refuses a link older than 10 minutes. The route is public: the new browser has no session yet.
import type { FastifyInstance } from "fastify";
import { sql, type Kysely } from "kysely";
import {
  ContractError,
  HTTP,
  routes,
  SESSION_TOKEN_BYTES,
  TransferClaim,
  TransferClaimResponse,
} from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { hashToken, newHexToken, setSessionCookie } from "./cookie.js";

// The sentence for a transfer link that was used or is past its 10 minutes.
export const TRANSFER_SPENT_SENTENCE =
  "This link was already used or is older than 10 minutes. Make a new one on the device that is signed in.";

// Spends the link and opens a session for its owner; null when the link was used, expired or never existed.
export async function claimTransferLink(
  db: Kysely<Database>,
  token: string,
  sessionToken: string,
): Promise<string | null> {
  const result = await sql<{
    person_id: string | null;
  }>`SELECT auth_claim_transfer(${hashToken(token)}, ${hashToken(sessionToken)}) AS person_id`.execute(
    db,
  );
  return result.rows[0]?.person_id ?? null;
}

// Registers POST /api/sessions/claim: 200 {personId} with a new session cookie, or 409 transfer_used_or_expired.
export function registerClaim(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.people.claim.path, async (request, reply) => {
    const body = TransferClaim.parse(request.body);
    const sessionToken = newHexToken(SESSION_TOKEN_BYTES);
    const personId = await claimTransferLink(deps.db, body.token, sessionToken);
    if (personId === null) {
      throw new ContractError("transfer_used_or_expired", TRANSFER_SPENT_SENTENCE, HTTP.conflict);
    }
    setSessionCookie(reply, sessionToken);
    return reply.code(200).send(TransferClaimResponse.parse({ personId }));
  });
}
