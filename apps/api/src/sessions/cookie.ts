import { createHash, randomBytes } from "node:crypto";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql, type Kysely } from "kysely";
import {
  COOKIE_ATTRIBUTES,
  routes,
  SESSION_COOKIE,
  SESSION_LIFETIME_DAYS,
} from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeSessionMissingError } from "../route-errors.js";

// A session token on the wire: 32 random bytes written as 64 lower-case hex characters.
export const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
// The cookie's Max-Age in seconds: 90 days, which is 7,776,000.
export const SESSION_MAX_AGE_SECONDS = SESSION_LIFETIME_DAYS * 86_400;
// The api routes that answer with no session, by their contracts names. Every other /api route refuses with session_missing when no
// live session came, so a new route is closed until it is listed here.
export const PUBLIC_ROUTES = [
  routes.people.createPerson,
  routes.people.recover,
  routes.people.claim,
  routes.people.health,
  routes.briefs.readShare,
  routes.people.authOptions,
  routes.people.googleStart,
  routes.people.googleCallback,
] as const;

// n random bytes as lower-case hex: 32 for a session, 16 for a transfer link or an invite.
export function newHexToken(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// The sha256 of a token's text exactly as the browser sends it; the database stores only this.
export function hashToken(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

// True when the method and the route pattern name one of PUBLIC_ROUTES; HEAD counts as GET.
export function isPublicRoute(method: string, routePattern: string): boolean {
  const wanted = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return PUBLIC_ROUTES.some(
    (route) => route.method.toUpperCase() === wanted && route.path === routePattern,
  );
}

// Sets __Host-session with HttpOnly, Secure, Path=/, SameSite=Lax and Max-Age 90 days, and no Domain.
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_ATTRIBUTES, maxAge: SESSION_MAX_AGE_SECONDS });
}

// Clears __Host-session: an empty value with the same attributes and Max-Age 0.
export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, "", { ...COOKIE_ATTRIBUTES, maxAge: 0 });
}

// The person behind a live session token hash, through auth_person_for_session, or null. A stream
// uses the hash it kept on the request, because the token itself is not kept after the cookie is read.
export async function findPersonForSessionHash(
  db: Kysely<Database>,
  tokenHash: Buffer,
): Promise<string | null> {
  const result = await sql<{
    person_id: string | null;
  }>`SELECT auth_person_for_session(${tokenHash}) AS person_id`.execute(db);
  return result.rows[0]?.person_id ?? null;
}

// The person behind a live session token, through auth_person_for_session, or null.
export async function findSessionPerson(
  db: Kysely<Database>,
  token: string,
): Promise<string | null> {
  return findPersonForSessionHash(db, hashToken(token));
}

// Registers the cookie parser and the session hook.
export async function addSessionHook(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await app.register(fastifyCookie);
  app.decorateRequest("personId", null);
  app.decorateRequest("sessionTokenHash", null);
  app.addHook("onRequest", async (request) => {
    const pattern: string | undefined = request.routeOptions.url;
    if (
      pattern === undefined ||
      !pattern.startsWith("/api/") ||
      isPublicRoute(request.method, pattern)
    ) {
      return;
    }
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined && SESSION_TOKEN_PATTERN.test(token)) {
      const tokenHash = hashToken(token);
      request.sessionTokenHash = tokenHash;
      request.personId = await findPersonForSessionHash(deps.db, tokenHash);
    }
    if (request.personId === null) {
      throw makeSessionMissingError();
    }
  });
}

// The person a route acts for; session_missing (401) when the hook found none.
export function requirePerson(request: FastifyRequest): string {
  if (request.personId === null) {
    throw makeSessionMissingError();
  }
  return request.personId;
}
