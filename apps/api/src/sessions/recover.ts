// POST /api/sessions/recover (A5): a person who lost the cookie types the 32-character code shown once at signup.
// auth_redeem_recovery spends the code in one conditional UPDATE and opens a new session, so a second try finds
// nothing (invariant 20). No fresh code is issued (ARCHITECTURE.md reconciled differences, "Recovery path").
import type { FastifyInstance } from "fastify";
import { sql, type Kysely } from "kysely";
import { ContractError, HTTP, Recover, RecoverResponse, routes, SESSION_TOKEN_BYTES } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { hashToken, newHexToken, setSessionCookie } from "./cookie.js";

// The sentence for a wrong or spent recovery code (A5).
export const RECOVERY_CODE_UNKNOWN_SENTENCE = "This code is wrong or was already used. Each code works once.";

// Spends the code and opens a session for its owner; null when the code is unknown, spent, or its person was deleted (A5, invariant 20).
export async function redeemRecoveryCode(db: Kysely<Database>, code: string, sessionToken: string): Promise<string | null> {
  const result = await sql<{ person_id: string | null }>`SELECT auth_redeem_recovery(${hashToken(code)}, ${hashToken(sessionToken)}) AS person_id`.execute(db);
  return result.rows[0]?.person_id ?? null;
}

// Registers POST /api/sessions/recover: 200 {personId} with a new session cookie, or 404 recovery_code_unknown (A5).
export function registerRecover(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.people.recover.path, async (request, reply) => {
    const body = Recover.parse(request.body);
    // The alphabet is lower case only, so a code typed in capitals names the same code [confirm] (A5 gives the length, not the case).
    const code = body.code.toLowerCase();
    const sessionToken = newHexToken(SESSION_TOKEN_BYTES);
    const personId = await redeemRecoveryCode(deps.db, code, sessionToken);
    if (personId === null) {
      throw new ContractError("recovery_code_unknown", RECOVERY_CODE_UNKNOWN_SENTENCE, HTTP.notFound);
    }
    setSessionCookie(reply, sessionToken);
    return reply.code(200).send(RecoverResponse.parse({ personId }));
  });
}
