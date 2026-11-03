import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql, type Kysely } from "kysely";
import { ContractError, HTTP, PersonCreate, PersonCreateResponse, RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH, routes, SESSION_TOKEN_BYTES } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { hashToken, newHexToken, setSessionCookie } from "./cookie.js";
import { ACCOUNT_RATE_LIMIT } from "./rate-limit.js";

// A 32-character recovery code from RECOVERY_CODE_ALPHABET; each character is drawn with crypto.randomInt, which gives each of the 31 symbols the same chance.
export function makeRecoveryCode(): string {
  return Array.from({ length: RECOVERY_CODE_LENGTH }, () => RECOVERY_CODE_ALPHABET.charAt(randomInt(RECOVERY_CODE_ALPHABET.length))).join("");
}

// Creates the person and the first session from the two hashes; the tokens themselves never reach the database.
export async function insertPerson(db: Kysely<Database>, input: { displayName: string; affiliations: string[]; recoveryCode: string; sessionToken: string }): Promise<string> {
  const result = await sql<{ person_id: string }>`SELECT auth_create_person(${input.displayName}, ${input.affiliations}, ${hashToken(input.recoveryCode)}, ${hashToken(input.sessionToken)}) AS person_id`.execute(db);
  const personId = result.rows[0]?.person_id;
  if (personId === undefined) {
    throw new Error("auth_create_person returned no row");
  }
  return personId;
}

// The sentence for a sign-up with no access code on a site that sets one.
export const ACCESS_CODE_NEEDED_SENTENCE = "Meety is invite-only for now. Enter the access code you were given.";
// The sentence for a sign-up with another access code than the site's.
export const ACCESS_CODE_WRONG_SENTENCE = "That access code is not right. Check it and try again.";

// Refuses a sign-up without the right access code when the site sets one. Capitals and spaces around the code do not matter,
// and the two codes are compared as digests, so the time the check takes says nothing about the code.
export function checkAccessCode(expected: string, given: string | undefined): void {
  if (expected === "") return;
  if (given === undefined) throw new ContractError("access_code_needed", ACCESS_CODE_NEEDED_SENTENCE, HTTP.forbidden);
  const digest = (code: string): Buffer => createHash("sha256").update(code.trim().toLowerCase()).digest();
  if (!timingSafeEqual(digest(expected), digest(given))) throw new ContractError("access_code_wrong", ACCESS_CODE_WRONG_SENTENCE, HTTP.forbidden);
}

// Registers POST /api/people: 201 {personId, recoveryCode} with the session cookie; 403 access_code_needed or access_code_wrong when
// the site sets ACCESS_CODE; counted by the account limit, wrong codes included.
export function registerCreatePerson(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.people.createPerson.path, { config: { rateLimit: ACCOUNT_RATE_LIMIT } }, async (request, reply) => {
    const body = PersonCreate.parse(request.body);
    checkAccessCode(deps.env.ACCESS_CODE, body.accessCode);
    const recoveryCode = makeRecoveryCode();
    const sessionToken = newHexToken(SESSION_TOKEN_BYTES);
    const personId = await insertPerson(deps.db, { displayName: body.displayName, affiliations: body.affiliations ?? [], recoveryCode, sessionToken });
    setSessionCookie(reply, sessionToken);
    return reply.code(201).send(PersonCreateResponse.parse({ personId, recoveryCode }));
  });
}
