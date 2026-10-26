import { afterAll, beforeAll, expect, it } from "vitest";
import { PersonCreateResponse, RecoverResponse, TransferClaimResponse, TransferResponse } from "@meet-first/contracts";
import { asPerson, createTestPerson } from "@meet-first/db/testing";
import type { FastifyInstance } from "fastify";
import type { LightMyRequestResponse } from "fastify";
import { registerPairsRoutes } from "../pairs/index.js";
import { registerWebPagesRoutes } from "../web-pages/index.js";
import { testLogLines, buildTestApp } from "../testing/app-factory.js";
import { readSessionCookie, sessionHeader } from "../testing/cookie-jar.js";
import { registerSessionsRoutes } from "./index.js";

const ORIGIN = "http://localhost:3000";
const U = "0f2b9d0c-4f0e-4f7e-9a63-5e8b2b1a9c11";
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

let t: Awaited<ReturnType<typeof buildTestApp>>;
let appUnderTest: FastifyInstance;

// Signs up one person through POST /api/people, from its own address so the account limit never trips.
function signUp(n: number, displayName: string): Promise<LightMyRequestResponse> {
  return appUnderTest.inject({
    method: "POST",
    url: "/api/people",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "192.0.2." + String(n) },
    payload: JSON.stringify({ displayName }),
  });
}

// The session token a response set, or undefined when it set none.
function tokenOf(response: LightMyRequestResponse): string | undefined {
  return readSessionCookie(response.headers["set-cookie"]);
}

// Every key name anywhere inside a parsed JSON value, so a test can prove a key is absent.
function keyNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => keyNames(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]: [string, unknown]) => [key, ...keyNames(inner)]);
  }
  return [];
}

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerSessionsRoutes, registerPairsRoutes, registerWebPagesRoutes] });
  appUnderTest = t.app;
});

afterAll(async () => {
  await t.close();
});

it("A7-T1: the sign-up cookie is __Host-session with HttpOnly, Secure, Path=/, SameSite=Lax, Max-Age 90 days and no Domain (invariant 21)", async () => {
  const r = await signUp(1, "A");

  expect(r.statusCode).toBe(201);
  const cookie = String(r.headers["set-cookie"]);
  expect(cookie).toMatch(/^__Host-session=[0-9a-f]{64};/);
  const attributes = cookie.split(";").slice(1).map((part) => part.trim());
  expect(attributes).toEqual(expect.arrayContaining(["HttpOnly", "Secure", "Path=/", "SameSite=Lax", "Max-Age=7776000"]));
  expect(attributes.some((attribute) => attribute.toLowerCase().startsWith("domain="))).toBe(false);
});

it("A7-T2: no session token reaches a response body or a log line through sign-up, recovery, transfer and claim (invariant 21)", async () => {
  const r1 = await signUp(2, "B");
  const tokenA = tokenOf(r1);
  const code = PersonCreateResponse.parse(r1.json()).recoveryCode;
  const r2 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/recover", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ code }) });
  const tokenB = tokenOf(r2);
  const r3 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: sessionHeader(tokenB ?? "") });
  const claimToken = new URL(TransferResponse.parse(r3.json()).url).hash.slice(1);
  const r4 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/claim", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ token: claimToken }) });
  const tokenC = tokenOf(r4);
  const log = testLogLines(appUnderTest).join("\n");

  expect([r1.statusCode, r2.statusCode, r3.statusCode, r4.statusCode]).toEqual([201, 200, 200, 200]);
  for (const token of [tokenA, tokenB, tokenC]) {
    expect(token).toMatch(TOKEN_PATTERN);
  }
  expect(new Set([tokenA, tokenB, tokenC]).size).toBe(3);
  for (const response of [r1, r2, r3, r4]) {
    for (const token of [tokenA, tokenB, tokenC]) {
      expect(response.body).not.toContain(String(token));
    }
  }
  for (const token of [tokenA, tokenB, tokenC]) {
    expect(log).not.toContain(String(token));
  }
  expect(log).not.toContain(code);
  expect(log).not.toContain(claimToken);
  expect(testLogLines(appUnderTest).length).toBeGreaterThanOrEqual(8);
  for (const response of [r1, r2, r3, r4]) {
    const names = keyNames(response.json());
    expect(names).not.toContain("token");
    expect(names).not.toContain("sessionToken");
    expect(names).not.toContain("session");
  }
});

it("A7-T3: a POST or DELETE without our exact Origin is 403 origin_mismatch and changes nothing (invariant 21)", async () => {
  const p = await createTestPerson(t.db, "C");

  const noOrigin = await appUnderTest.inject({ method: "POST", url: "/api/people", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.3" }, payload: JSON.stringify({ displayName: "C2" }) });
  const evilOrigin = await appUnderTest.inject({ method: "POST", url: "/api/people", headers: { origin: "http://evil.example", "content-type": "application/json", "x-forwarded-for": "192.0.2.3" }, payload: JSON.stringify({ displayName: "C2" }) });
  const deleteNoOrigin = await appUnderTest.inject({ method: "DELETE", url: "/api/people/me", headers: { cookie: "__Host-session=" + p.sessionToken } });
  const state = await asPerson(t.db, p.personId, (trx) => trx.selectFrom("people").select("state").where("id", "=", p.personId).executeTakeFirstOrThrow());
  const pairFromPort = await appUnderTest.inject({ method: "POST", url: "/api/pairs", headers: { ...sessionHeader(p.sessionToken), origin: "http://localhost:3001" } });
  const health = await appUnderTest.inject({ method: "GET", url: "/api/health" });

  for (const response of [noOrigin, evilOrigin]) {
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "origin_mismatch", message: "Open the app from its own address and try again." });
    expect(response.headers["set-cookie"]).toBeUndefined();
  }
  expect(deleteNoOrigin.statusCode).toBe(403);
  expect(state.state).toBe("active");
  expect(pairFromPort.statusCode).toBe(403);
  expect(health.statusCode).toBe(200);
});

it("A7-T4: a non-public /api route answers 401 session_missing without a live session, and the public routes answer without one", async () => {
  const p = await createTestPerson(t.db, "D");
  await asPerson(t.db, p.personId, (trx) => trx.updateTable("sessions").set({ revoked_at: new Date() }).where("person_id", "=", p.personId).execute());
  const sessionMissing = { code: "session_missing", message: "Sign in again from the start page." };

  const noCookiePair = await appUnderTest.inject({ method: "POST", url: "/api/pairs", headers: { origin: ORIGIN } });
  const noCookieRead = await appUnderTest.inject({ method: "GET", url: "/api/pairs/" + U });
  const zeroCookie = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: { origin: ORIGIN, cookie: "__Host-session=" + "0".repeat(64) } });
  const shortCookie = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: { origin: ORIGIN, cookie: "__Host-session=abc" } });
  const revokedCookie = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: sessionHeader(p.sessionToken) });
  const health = await appUnderTest.inject({ method: "GET", url: "/api/health" });
  const recover = await appUnderTest.inject({ method: "POST", url: "/api/sessions/recover", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ code: "a".repeat(32) }) });
  const claim = await appUnderTest.inject({ method: "POST", url: "/api/sessions/claim", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ token: "0".repeat(32) }) });

  for (const response of [noCookiePair, noCookieRead, zeroCookie, shortCookie, revokedCookie]) {
    expect(response.statusCode).toBe(401);
  }
  expect(noCookiePair.json()).toEqual(sessionMissing);
  expect(health.statusCode).toBe(200);
  expect(recover.statusCode).toBe(404);
  expect(recover.json()).toMatchObject({ code: "recovery_code_unknown" });
  expect(claim.statusCode).toBe(409);
  expect(claim.json()).toMatchObject({ code: "transfer_used_or_expired" });
});

it("A5-T1: a recovery code redeems once, opens a new session, and the second try is 404 recovery_code_unknown (invariant 20)", async () => {
  const r1 = await signUp(4, "E");
  const r2 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/recover", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ code: PersonCreateResponse.parse(r1.json()).recoveryCode }) });
  const token2 = tokenOf(r2);
  const r3 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: sessionHeader(token2 ?? "") });
  const r4 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/recover", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ code: PersonCreateResponse.parse(r1.json()).recoveryCode }) });

  expect(r2.statusCode).toBe(200);
  expect(r2.json()).toEqual({ personId: PersonCreateResponse.parse(r1.json()).personId });
  expect(token2).toMatch(TOKEN_PATTERN);
  expect(token2).not.toBe(tokenOf(r1));
  expect(r3.statusCode).toBe(200);
  expect(r4.statusCode).toBe(404);
  expect(r4.json()).toEqual({ code: "recovery_code_unknown", message: "This code is wrong or was already used. Each code works once." });
  expect(r4.headers["set-cookie"]).toBeUndefined();
});

it("A5-T2: a recovery code typed in capitals still redeems, because the alphabet is lower case only", async () => {
  const r1 = await signUp(5, "F");
  const created = PersonCreateResponse.parse(r1.json());
  const r2 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/recover", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ code: created.recoveryCode.toUpperCase() }) });

  expect(r2.statusCode).toBe(200);
  expect(RecoverResponse.parse(r2.json())).toEqual({ personId: created.personId });
});

it("R9.2-T1: a transfer link claims once in a new browser, and the second claim is 409 transfer_used_or_expired", async () => {
  const p = await createTestPerson(t.db, "G");
  const r1 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: sessionHeader(p.sessionToken) });
  const parsed = TransferResponse.parse(r1.json());
  const token = new URL(parsed.url).hash.slice(1);
  const r2 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/claim", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ token }) });
  const r3 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/claim", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ token }) });

  expect(r1.statusCode).toBe(200);
  expect(parsed.url).toMatch(/^http:\/\/localhost:3000\/claim#([0-9a-f]{32})$/);
  const remaining = Date.parse(parsed.expiresAt) - Date.now();
  expect(remaining).toBeGreaterThanOrEqual(595_000);
  expect(remaining).toBeLessThanOrEqual(605_000);
  expect(r2.statusCode).toBe(200);
  expect(TransferClaimResponse.parse(r2.json())).toEqual({ personId: p.personId });
  const claimedToken = tokenOf(r2);
  expect(claimedToken).toMatch(TOKEN_PATTERN);
  expect(claimedToken).not.toBe(p.sessionToken);
  expect(r3.statusCode).toBe(409);
  expect(r3.json()).toEqual({ code: "transfer_used_or_expired", message: "This link was already used or is older than 10 minutes. Make a new one on the device that is signed in." });
});

it("R9.2-T2: a transfer link past its 10 minutes is 409 transfer_used_or_expired", async () => {
  const p = await createTestPerson(t.db, "H");
  const r1 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: sessionHeader(p.sessionToken) });
  const token = new URL(TransferResponse.parse(r1.json()).url).hash.slice(1);
  await asPerson(t.db, p.personId, (trx) => trx.updateTable("transfer_links").set({ expires_at: new Date(Date.now() - 1_000) }).where("person_id", "=", p.personId).execute());

  const r2 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/claim", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ token }) });

  expect(r2.statusCode).toBe(409);
  expect(r2.json()).toMatchObject({ code: "transfer_used_or_expired" });
});

it("R9.5-T1: the 11th account from one address in an hour is 429 too_many_accounts, and another address still gets 201", async () => {
  const statuses: number[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const r = await appUnderTest.inject({ method: "POST", url: "/api/people", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "203.0.113.7" }, payload: JSON.stringify({ displayName: "R" + String(i) }) });
    statuses.push(r.statusCode);
  }
  const eleventh = await appUnderTest.inject({ method: "POST", url: "/api/people", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "203.0.113.7" }, payload: JSON.stringify({ displayName: "R11" }) });
  const other = await appUnderTest.inject({ method: "POST", url: "/api/people", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "198.51.100.9" }, payload: JSON.stringify({ displayName: "R12" }) });

  expect(statuses.every((status) => status === 201)).toBe(true);
  expect(eleventh.statusCode).toBe(429);
  expect(eleventh.json()).toMatchObject({ code: "too_many_accounts", message: "This network made 10 accounts in the last hour. Wait an hour, then try again." });
  expect(other.statusCode).toBe(201);
});

it("D4-T1: a JSON body over 1 MiB is 413 payload_too_large", async () => {
  const r = await appUnderTest.inject({ method: "POST", url: "/api/people", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "192.0.2.6" }, payload: JSON.stringify({ displayName: "a".repeat(1_048_576) }) });

  expect(r.statusCode).toBe(413);
  expect(r.json()).toEqual({ code: "payload_too_large", message: "The request body is over the size limit for this route. Send a smaller body." });
});
