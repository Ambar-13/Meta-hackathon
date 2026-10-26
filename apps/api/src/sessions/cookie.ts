import { createHash, randomBytes } from "node:crypto";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql, type Kysely } from "kysely";
import { COOKIE_ATTRIBUTES, routes, SESSION_COOKIE, SESSION_LIFETIME_DAYS } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeSessionMissingError } from "../route-errors.js";

// A session token on the wire: 32 random bytes (D33) written as 64 lower-case hex characters [confirm] (Wave 0 fixes the size, not the text form).
export const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
// The cookie's Max-Age in seconds: 90 days (D33), which is 7,776,000.
export const SESSION_MAX_AGE_SECONDS = SESSION_LIFETIME_DAYS * 86_400;
// The api routes that answer with no session, by their contracts names; IMPLEMENTATION.md 2.2 marks exactly these five public. Every other /api route refuses with session_missing when no live session came (A7) [confirm] (refusing by default is this spec's choice).
export const PUBLIC_ROUTES = [routes.people.createPerson, routes.people.recover, routes.people.claim, routes.people.health, routes.briefs.readShare] as const;

// n random bytes as lower-case hex: 32 for a session (D33), 16 for a transfer link (D33) or an invite (D32).
export function newHexToken(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// The sha256 of a token's text exactly as the browser sends it; the database stores only this (D32, D33, A5).
export function hashToken(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

// True when the method and the route pattern name one of PUBLIC_ROUTES; HEAD counts as GET.
export function isPublicRoute(method: string, routePattern: string): boolean {
  const wanted = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return PUBLIC_ROUTES.some((route) => route.method.toUpperCase() === wanted && route.path === routePattern);
}

// Sets __Host-session with HttpOnly, Secure, Path=/, SameSite=Lax and Max-Age 90 days, and no Domain (A7, D33, invariant 21).
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_ATTRIBUTES, maxAge: SESSION_MAX_AGE_SECONDS });
}

// Clears __Host-session: an empty value with the same attributes and Max-Age 0 (D69).
export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, "", { ...COOKIE_ATTRIBUTES, maxAge: 0 });
}

// The person behind a live session token, through auth_person_for_session, or null (D33).
export async function findSessionPerson(db: Kysely<Database>, token: string): Promise<string | null> {
  const result = await sql<{ person_id: string | null }>`SELECT auth_person_for_session(${hashToken(token)}) AS person_id`.execute(db);
  return result.rows[0]?.person_id ?? null;
}

// Registers the cookie parser and the session hook (A7).
export async function addSessionHook(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await app.register(fastifyCookie);
  app.decorateRequest("personId", null);
  app.addHook("onRequest", async (request) => {
    const pattern: string | undefined = request.routeOptions.url;
    if (pattern === undefined || !pattern.startsWith("/api/") || isPublicRoute(request.method, pattern)) {
      return;
    }
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined && SESSION_TOKEN_PATTERN.test(token)) {
      request.personId = await findSessionPerson(deps.db, token);
    }
    if (request.personId === null) {
      throw makeSessionMissingError();
    }
  });
}

// The person a route acts for; session_missing (401) when the hook found none (docs/contracts.md section 4).
export function requirePerson(request: FastifyRequest): string {
  if (request.personId === null) {
    throw makeSessionMissingError();
  }
  return request.personId;
}
