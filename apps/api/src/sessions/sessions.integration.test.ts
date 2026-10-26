import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DeletionResponse, PersonCreateResponse, TransferResponse } from "@meet-first/contracts";
import { asPerson, createTestPerson } from "@meet-first/db/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildTestApp, enqueuedJobs } from "../testing/app-factory.js";
import { readSessionCookie, sessionHeader } from "../testing/cookie-jar.js";
import { registerSessionsRoutes } from "./index.js";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

let t: Awaited<ReturnType<typeof buildTestApp>>;
let appUnderTest: FastifyInstance;

// sha256 of a text as UTF-8, the way every stored token hash is made.
function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

// The session token a response set, or undefined when it set none.
function tokenOf(response: LightMyRequestResponse): string | undefined {
  return readSessionCookie(response.headers["set-cookie"]);
}

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerSessionsRoutes] });
  appUnderTest = t.app;
});

afterAll(async () => {
  await t.close();
});

it("D33-T1: sign-up stores only the sha256 of the session token and of the recovery code, and the session lives 90 days", async () => {
  const r = await appUnderTest.inject({
    method: "POST",
    url: "/api/people",
    headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "192.0.2.20" },
    payload: JSON.stringify({ displayName: "Dee", affiliations: ["Acme"] }),
  });
  const body = PersonCreateResponse.parse(r.json());
  const token = tokenOf(r) ?? "";

  expect(r.statusCode).toBe(201);
  expect(token).toMatch(TOKEN_PATTERN);
  const stored = await asPerson(t.db, body.personId, async (trx) => {
    const sessions = await trx.selectFrom("sessions").selectAll().where("person_id", "=", body.personId).execute();
    const person = await trx.selectFrom("people").selectAll().where("id", "=", body.personId).executeTakeFirstOrThrow();
    return { sessions, person };
  });
  expect(stored.sessions.length).toBe(1);
  const session = stored.sessions[0];
  if (session === undefined) throw new Error("the sign-up made no session row");
  expect(session.token_hash.equals(sha256(token))).toBe(true);
  expect(Math.abs(session.expires_at.getTime() - session.created_at.getTime() - 7_776_000_000)).toBeLessThanOrEqual(1000);
  expect(stored.person.display_name).toBe("Dee");
  expect(stored.person.affiliations).toEqual(["Acme"]);
  expect(stored.person.state).toBe("active");
  expect(stored.person.recovery_code_used_at).toBeNull();
  expect(stored.person.recovery_code_hash?.equals(sha256(body.recoveryCode))).toBe(true);
});

it("D33-T2: a transfer link is stored as the sha256 of its token, expires 10 minutes after it is made, and its claim marks it used", async () => {
  const p = await createTestPerson(t.db, "Tee");
  const r1 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: sessionHeader(p.sessionToken) });
  const token = new URL(TransferResponse.parse(r1.json()).url).hash.slice(1);
  const before = await asPerson(t.db, p.personId, (trx) => trx.selectFrom("transfer_links").selectAll().where("person_id", "=", p.personId).execute());

  const r2 = await appUnderTest.inject({ method: "POST", url: "/api/sessions/claim", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, payload: JSON.stringify({ token }) });
  const after = await asPerson(t.db, p.personId, (trx) => trx.selectFrom("transfer_links").selectAll().where("person_id", "=", p.personId).execute());
  const sessionCount = await asPerson(t.db, p.personId, (trx) => trx.selectFrom("sessions").select("id").where("person_id", "=", p.personId).execute());

  expect(before.length).toBe(1);
  const link = before[0];
  if (link === undefined) throw new Error("the transfer made no link row");
  expect(link.token_hash.equals(sha256(token))).toBe(true);
  expect(Math.abs(link.expires_at.getTime() - link.created_at.getTime() - 600_000)).toBeLessThanOrEqual(1000);
  expect(link.used_at).toBeNull();
  expect(r2.statusCode).toBe(200);
  expect(after[0]?.used_at).not.toBeNull();
  expect(sessionCount.length).toBe(2);
});

it("D69-T1: DELETE /api/people/me marks the person deleted, revokes every session, writes the deletions row, enqueues delete_person and answers 202 with the cookie cleared", async () => {
  const p = await createTestPerson(t.db, "Del");
  const recovered = await appUnderTest.inject({ method: "POST", url: "/api/sessions/recover", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, payload: JSON.stringify({ code: p.recoveryCode }) });
  expect(recovered.statusCode).toBe(200);

  const r = await appUnderTest.inject({ method: "DELETE", url: "/api/people/me", headers: sessionHeader(p.sessionToken) });
  const body = DeletionResponse.parse(r.json());
  const cookie = String(r.headers["set-cookie"]);
  const state = await asPerson(t.db, p.personId, async (trx) => {
    const person = await trx.selectFrom("people").select(["state", "deleted_at"]).where("id", "=", p.personId).executeTakeFirstOrThrow();
    const live = await trx.selectFrom("sessions").select("id").where("person_id", "=", p.personId).where("revoked_at", "is", null).execute();
    const deletion = await trx.selectFrom("deletions").selectAll().where("id", "=", body.deletionId).executeTakeFirstOrThrow();
    return { person, live, deletion };
  });
  const jobs = enqueuedJobs(appUnderTest);
  const lastJob = jobs[jobs.length - 1];

  expect(r.statusCode).toBe(202);
  expect(cookie.startsWith("__Host-session=;")).toBe(true);
  expect(cookie).toContain("Max-Age=0");
  expect(cookie).toContain("Path=/");
  expect(state.person.state).toBe("deleted");
  expect(state.person.deleted_at).not.toBeNull();
  expect(state.live.length).toBe(0);
  expect(state.deletion.person_id).toBe(p.personId);
  expect(state.deletion.requested_at).not.toBeNull();
  expect(state.deletion.completed_at).toBeNull();
  expect(lastJob).toEqual({ name: "delete_person", payload: { personId: p.personId } });
});

it("D69-T2: after deletion the old cookie is refused with 401 session_missing", async () => {
  const p = await createTestPerson(t.db, "Gone");
  const deleted = await appUnderTest.inject({ method: "DELETE", url: "/api/people/me", headers: sessionHeader(p.sessionToken) });
  expect(deleted.statusCode).toBe(202);

  const r = await appUnderTest.inject({ method: "POST", url: "/api/sessions/transfer", headers: sessionHeader(p.sessionToken) });

  expect(r.statusCode).toBe(401);
  expect(r.json()).toMatchObject({ code: "session_missing" });
});
