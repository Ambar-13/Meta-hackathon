// Sign in with Google (3 Nov 2026, Ambar: "add oauth google and let people just use meety"): OpenID Connect's authorization code flow plain-words: allow (his words, quoted)
// with PKCE. GET /api/auth/google sends the browser to Google with a fresh state, nonce and code verifier kept in a 10-minute cookie;
// Google sends it back to GET /api/auth/google/callback with a one-time code, which the server swaps for an ID token at Google's token
// endpoint with the client secret and the verifier. The token comes straight from Google over HTTPS to a client that proved itself, so
// its claims are read without checking its signature, as Google's OpenID Connect guide allows; its issuer, audience, expiry and nonce
// are still checked. Meety asks only for openid and profile and keeps the subject and the name, never the email; a new subject makes a
// new person, with no access code, since a script cannot make Google accounts at will. The one-time code shows in the request log's
// address, where it is worth nothing without the client secret and the browser's verifier.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { AuthOptions, COOKIE_ATTRIBUTES, DISPLAY_NAME_MAX_CHARS, GOOGLE_RESULT_QUERY, routes, SESSION_TOKEN_BYTES, type GoogleSignInResult } from "@meet-first/contracts";
import type { RouteDeps } from "../app-types.js";
import { hashToken, newHexToken, setSessionCookie } from "./cookie.js";

// Google's authorization endpoint, where the browser signs in.
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// Google's token endpoint, where the server swaps the one-time code for an ID token.
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// The two ways Google writes its issuer.
const GOOGLE_ISSUERS: ReadonlySet<string> = new Set(["https://accounts.google.com", "accounts.google.com"]);
// The cookie that carries a sign-in's state, nonce and verifier from the start to the callback; __Host- keeps it to this exact site.
const GOOGLE_COOKIE = "__Host-google";
// How long a sign-in may take at Google, in seconds.
const GOOGLE_COOKIE_MAX_AGE_SECONDS = 600;
// How long the server waits for Google's token endpoint, in milliseconds.
const TOKEN_TIMEOUT_MS = 10_000;
// The name a person gets when Google gives none.
const NAME_FALLBACK = "New Meety";
// Where a signed-in person lands.
const HOME_PATH = "/home";

// The callback's limit: 60 sign-ins per address per hour, so a room of people on one network can all sign in, while a script still cannot
// make accounts at will, since each needs a Google account. Sign-up's own limit is 10 (rate-limit.ts).
const GOOGLE_SIGN_IN_RATE_LIMIT = {
  max: 60,
  timeWindow: 3_600_000,
  errorResponseBuilder: (): { statusCode: number; code: string; message: string } => ({ statusCode: 429, code: "too_many_sign_ins", message: "This network signed in with Google 60 times in the last hour. Wait a little, then try again." }),
};

// What the token endpoint answers, of which only the ID token is read.
const TokenReply = z.object({ id_token: z.string().min(1) });
// The claims of the ID token that Meety reads.
const IdClaims = z.object({
  iss: z.string(), aud: z.string(), sub: z.string().min(1).max(255), exp: z.number(), nonce: z.string().optional(), name: z.string().optional(), given_name: z.string().optional(),
});
// The type of IdClaims, read from the schema above.
export type IdClaims = z.infer<typeof IdClaims>;
// The query Google sends the callback: the code and the state, or an error when the person said no.
const CallbackQuery = z.object({ code: z.string().min(1).max(2048).optional(), state: z.string().max(128).optional(), error: z.string().max(200).optional() });

// One sign-in's secrets: the state that ties the callback to this browser, the nonce Google puts in the token, and the PKCE verifier.
export type PendingSignIn = { state: string; nonce: string; verifier: string };

// A fresh sign-in's secrets, each random and URL-safe.
function newPending(): PendingSignIn {
  return { state: randomBytes(24).toString("base64url"), nonce: randomBytes(24).toString("base64url"), verifier: randomBytes(32).toString("base64url") };
}

// A sign-in's secrets as the cookie holds them: the three parts joined by dots.
export function pendingText(pending: PendingSignIn): string {
  return `${pending.state}.${pending.nonce}.${pending.verifier}`;
}
// The cookie's text read back into a sign-in's secrets; null for a cookie that is missing or not one Meety wrote.
export function readPending(text: string | undefined): PendingSignIn | null {
  const parts = (text ?? "").split(".");
  const [state, nonce, verifier] = parts;
  if (parts.length !== 3 || state === undefined || nonce === undefined || verifier === undefined) return null;
  return parts.every((part) => /^[A-Za-z0-9_-]{20,64}$/.test(part)) ? { state, nonce, verifier } : null;
}

// True when the site has a Google client.
function isGoogleOn(deps: RouteDeps): boolean {
  return deps.env.GOOGLE_CLIENT_ID !== "" && deps.env.GOOGLE_CLIENT_SECRET !== "";
}

// The address Google sends the browser back to: the site's own origin and the callback path, as registered with the Google client.
export function callbackUrl(origin: string): string {
  return new URL(routes.people.googleCallback.path, origin).toString();
}

// Google's sign-in address for one sign-in: the code flow with PKCE, asking only for openid and profile (the name), never the email,
// and letting the person pick an account.
export function googleAuthUrl(input: { clientId: string; origin: string; pending: PendingSignIn }): string {
  const { pending } = input;
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId, redirect_uri: callbackUrl(input.origin), response_type: "code", scope: "openid profile", state: pending.state, nonce: pending.nonce,
    code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return url.toString();
}

// The claims of an ID token, read from its middle part; null when it is not a token or not one Meety can read.
export function claimsOf(idToken: string): IdClaims | null {
  const payload = idToken.split(".")[1];
  if (payload === undefined) return null;
  try {
    const parsed = IdClaims.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// True when the claims come from Google, are for this client, have not expired and carry this sign-in's nonce.
export function areClaimsValid(claims: IdClaims, input: { clientId: string; nonce: string; nowSeconds: number }): boolean {
  return GOOGLE_ISSUERS.has(claims.iss) && claims.aud === input.clientId && claims.exp > input.nowSeconds && claims.nonce === input.nonce;
}

// The display name from the claims: the full name, else the first name, else NAME_FALLBACK, cut to DISPLAY_NAME_MAX_CHARS characters.
export function nameOf(claims: IdClaims): string {
  const name = (claims.name ?? claims.given_name ?? "").trim();
  return Array.from(name === "" ? NAME_FALLBACK : name).slice(0, DISPLAY_NAME_MAX_CHARS).join("");
}

// Swaps the one-time code for the ID token's claims at Google's token endpoint; null when Google refuses it, cannot be reached in
// TOKEN_TIMEOUT_MS, or answers something else.
async function exchangeCode(deps: RouteDeps, input: { code: string; verifier: string }): Promise<IdClaims | null> {
  const body = new URLSearchParams({
    code: input.code, client_id: deps.env.GOOGLE_CLIENT_ID, client_secret: deps.env.GOOGLE_CLIENT_SECRET, redirect_uri: callbackUrl(deps.env.APP_ORIGIN),
    grant_type: "authorization_code", code_verifier: input.verifier,
  });
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) });
    if (!response.ok) return null;
    const reply = TokenReply.safeParse(await response.json());
    return reply.success ? claimsOf(reply.data.id_token) : null;
  } catch {
    return null;
  }
}

// Sends the browser to the start page with why the sign-in did not finish.
function backToStart(reply: FastifyReply, result: GoogleSignInResult): FastifyReply {
  return reply.redirect(`/?${GOOGLE_RESULT_QUERY}=${result}`, 303);
}

// The claims of a callback that checks out: the query names this sign-in's state and a code, and Google swaps that code for claims
// that are valid; else why it did not finish.
async function checkedClaims(deps: RouteDeps, query: z.infer<typeof CallbackQuery>, pending: PendingSignIn): Promise<IdClaims | GoogleSignInResult> {
  if (query.error !== undefined) return query.error === "access_denied" ? "cancelled" : "failed";
  if (query.code === undefined || query.state !== pending.state) return "failed";
  const claims = await exchangeCode(deps, { code: query.code, verifier: pending.verifier });
  const isValid = claims !== null && areClaimsValid(claims, { clientId: deps.env.GOOGLE_CLIENT_ID, nonce: pending.nonce, nowSeconds: Math.floor(deps.now().getTime() / 1000) });
  return isValid ? claims : "failed";
}

// Registers GET /api/auth/google/callback: with a code that checks out, the person behind the Google account, or a new person the first
// time, gets a session cookie and 303 to Home; otherwise 303 to the start page with ?google=cancelled or ?google=failed. The sign-in's
// cookie is spent either way. Counted by its own limit per address, looser than sign-up's.
function registerCallback(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.people.googleCallback.path, { config: { rateLimit: GOOGLE_SIGN_IN_RATE_LIMIT } }, async (request, reply) => {
    const pending = readPending(request.cookies[GOOGLE_COOKIE]);
    reply.setCookie(GOOGLE_COOKIE, "", { ...COOKIE_ATTRIBUTES, maxAge: 0 });
    const query = CallbackQuery.safeParse(request.query);
    if (!query.success || pending === null || !isGoogleOn(deps)) return backToStart(reply, "failed");
    const claims = await checkedClaims(deps, query.data, pending);
    if (typeof claims === "string") return backToStart(reply, claims);
    const sessionToken = newHexToken(SESSION_TOKEN_BYTES);
    const result = await sql<{ person_id: string | null }>`SELECT auth_google_person(${claims.sub}, ${nameOf(claims)}, ${hashToken(sessionToken)}) AS person_id`.execute(deps.db);
    if ((result.rows[0]?.person_id ?? null) === null) return backToStart(reply, "failed");
    setSessionCookie(reply, sessionToken);
    return reply.redirect(HOME_PATH, 303);
  });
}

// Registers the Google sign-in routes: GET /api/auth/options (200 AuthOptions, whether Continue with Google is on), GET /api/auth/google
// (303 to Google with a fresh sign-in's cookie, or back to the start page with ?google=failed when the site has no Google client), and
// the callback.
export function registerGoogleSignIn(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.people.authOptions.path, async (request, reply) => reply.code(200).send(AuthOptions.parse({ google: isGoogleOn(deps) })));
  app.get(routes.people.googleStart.path, async (request, reply) => {
    if (!isGoogleOn(deps)) return backToStart(reply, "failed");
    const pending = newPending();
    reply.setCookie(GOOGLE_COOKIE, pendingText(pending), { ...COOKIE_ATTRIBUTES, maxAge: GOOGLE_COOKIE_MAX_AGE_SECONDS });
    return reply.redirect(googleAuthUrl({ clientId: deps.env.GOOGLE_CLIENT_ID, origin: deps.env.APP_ORIGIN, pending }), 303);
  });
  registerCallback(app, deps);
}
