// What exists: anyone can make an account with one POST, because there is no email and no password.
// The problem: a script could make thousands of accounts and spend the model budget through them.
// The step: because server.ts trusts exactly one proxy hop, request.ip is the address that proxy appended to
// X-Forwarded-For, which a client cannot forge, and POST /api/people allows 10 accounts per address per hour
// (PERSON_CREATE_RATE_LIMIT).
// What it does not do: the count lives in this process's memory, so a restart resets it and two api processes
// would each count on their own; no other route is limited here.
// (Technical name: @fastify/rate-limit with one per-route limit and no global limit.)
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { PERSON_CREATE_RATE_LIMIT } from "@meet-first/contracts";

// The sentence for the 11th account from one address in an hour.
export const TOO_MANY_ACCOUNTS_SENTENCE = "This network made 10 accounts in the last hour. Wait an hour, then try again.";

// The limiter's refusal. It carries statusCode, code and message, so it ends as a 429 with this code and sentence
// whether the plugin throws it (then handleRouteError rule 3 reads it) or sends it as the body.
export function buildTooManyAccounts(): { statusCode: number; code: string; message: string } {
  return { statusCode: 429, code: "too_many_accounts", message: TOO_MANY_ACCOUNTS_SENTENCE };
}

// The per-route setting for POST /api/people: 10 per address per hour, counted on every request that reaches the route.
export const ACCOUNT_RATE_LIMIT = {
  max: PERSON_CREATE_RATE_LIMIT.max,
  timeWindow: PERSON_CREATE_RATE_LIMIT.windowMs,
  errorResponseBuilder: buildTooManyAccounts,
};

// Registers the limiter with no global limit, so only a route whose config names a limit is counted: ACCOUNT_RATE_LIMIT here, and the
// Google sign-in callback's own (google-sign-in.ts).
export async function registerAccountRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { global: false });
}
