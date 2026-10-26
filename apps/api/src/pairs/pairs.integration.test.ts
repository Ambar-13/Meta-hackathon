import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "kysely";
import { PairCreateResponse, PairJoinResponse, PairView } from "@meet-first/contracts";
import { asMeeting, asPerson, createPairedMeeting, createTestPerson } from "@meet-first/db/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildTestApp } from "../testing/app-factory.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerSessionsRoutes } from "../sessions/index.js";
import { registerPairsRoutes } from "./index.js";

const SECOND_QUESTION = "Who decides when we disagree and cannot wait?";

let t: Awaited<ReturnType<typeof buildTestApp>>;
let appUnderTest: FastifyInstance;
let a: { personId: string; sessionToken: string };
let b: { personId: string; sessionToken: string };
let c: { personId: string; sessionToken: string };

// sha256 of a text as UTF-8, the way every stored invite hash is made.
function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

// The invite token after "#" in an invite link.
function tokenOfInvite(url: string): string {
  return new URL(url).hash.slice(1);
}

// Makes a second meeting in a pair, on the curated question 2, through meeting_create (granted to app_api).
async function secondMeeting(m: { pairId: string; a: { personId: string; cardId: string } }): Promise<string> {
  const result = await sql<{ id: string | null }>`SELECT meeting_create(${m.pairId}::uuid, ${m.a.personId}::uuid, ${m.a.cardId}::uuid, 2, ${SECOND_QUESTION}, true) AS id`.execute(t.db);
  const id = result.rows[0]?.id;
  if (id === null || id === undefined) throw new Error("meeting_create returned no id");
  return id;
}

// POST /api/pairs as one person, so an invite can be made.
function makeInvite(token: string): Promise<LightMyRequestResponse> {
  return appUnderTest.inject({ method: "POST", url: "/api/pairs", headers: sessionHeader(token) });
}

// POST /api/pairs/join as one person with an invite token.
function joinWith(token: string, invite: string): Promise<LightMyRequestResponse> {
  return appUnderTest.inject({ method: "POST", url: "/api/pairs/join", headers: { ...sessionHeader(token), "content-type": "application/json" }, payload: JSON.stringify({ token: invite }) });
}

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerSessionsRoutes, registerPairsRoutes] });
  appUnderTest = t.app;
  const pa = await createTestPerson(t.db, "Ana");
  const pb = await createTestPerson(t.db, "Ben");
  const pc = await createTestPerson(t.db, "Cal");
  a = { personId: pa.personId, sessionToken: pa.sessionToken };
  b = { personId: pb.personId, sessionToken: pb.sessionToken };
  c = { personId: pc.personId, sessionToken: pc.sessionToken };
});

afterAll(async () => {
  await t.close();
});

it("D32-T1: POST /api/pairs answers 201 with an invite link that carries a 128-bit token after \"#\" and expires in 24 hours", async () => {
  const r = await makeInvite(a.sessionToken);
  const body = PairCreateResponse.parse(r.json());
  const token = tokenOfInvite(body.inviteUrl);
  const stored = await asPerson(t.db, a.personId, (trx) => trx.selectFrom("pairs").selectAll().where("id", "=", body.pairId).executeTakeFirstOrThrow());
  const remaining = Date.parse(body.expiresAt) - Date.now();

  expect(r.statusCode).toBe(201);
  expect(body.inviteUrl).toMatch(/^http:\/\/localhost:3000\/join#([0-9a-f]{32})$/);
  expect(remaining).toBeGreaterThanOrEqual(86_395_000);
  expect(remaining).toBeLessThanOrEqual(86_405_000);
  expect(stored.token_hash.equals(sha256(token))).toBe(true);
  expect(stored.creator_person_id).toBe(a.personId);
  expect(stored.joiner_person_id).toBeNull();
});

it("R9.3-T1: the first join wins; a second join, a third person and the creator's own join are 409 pair_unavailable (invariant 8)", async () => {
  const pair1 = PairCreateResponse.parse((await makeInvite(a.sessionToken)).json());
  const token1 = tokenOfInvite(pair1.inviteUrl);

  const first = await joinWith(b.sessionToken, token1);
  const second = await joinWith(b.sessionToken, token1);
  const third = await joinWith(c.sessionToken, token1);
  const pair2 = PairCreateResponse.parse((await makeInvite(a.sessionToken)).json());
  const own = await joinWith(a.sessionToken, tokenOfInvite(pair2.inviteUrl));
  const rows = await asPerson(t.db, a.personId, (trx) => trx.selectFrom("pairs").selectAll().where("id", "in", [pair1.pairId, pair2.pairId]).execute());
  const row1 = rows.find((row) => row.id === pair1.pairId);
  const row2 = rows.find((row) => row.id === pair2.pairId);

  expect(first.statusCode).toBe(200);
  expect(PairJoinResponse.parse(first.json())).toEqual({ pairId: pair1.pairId });
  for (const response of [second, third, own]) {
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "pair_unavailable", message: "This invite was already used, has expired, or is your own. Ask for a new link." });
  }
  expect(row1?.joiner_person_id).toBe(b.personId);
  expect(row1?.joined_at).not.toBeNull();
  expect(row2?.joiner_person_id).toBeNull();
});

it("D32-T2: an invite past its 24 hours is 409 pair_unavailable", async () => {
  const pair3 = PairCreateResponse.parse((await makeInvite(a.sessionToken)).json());
  await asPerson(t.db, a.personId, (trx) => trx.updateTable("pairs").set({ expires_at: new Date(Date.now() - 1_000) }).where("id", "=", pair3.pairId).execute());

  const r = await joinWith(c.sessionToken, tokenOfInvite(pair3.inviteUrl));

  expect(r.statusCode).toBe(409);
  expect(r.json()).toMatchObject({ code: "pair_unavailable" });
});

it("D54-T1: GET /api/pairs/:id answers PairView with both display names and the pair's meetings, newest first", async () => {
  const m = await createPairedMeeting(t.db);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const id2 = await secondMeeting(m);
  const nameA = (await asPerson(t.db, m.a.personId, (trx) => trx.selectFrom("people").select("display_name").where("id", "=", m.a.personId).executeTakeFirstOrThrow())).display_name;
  const nameB = (await asPerson(t.db, m.b.personId, (trx) => trx.selectFrom("people").select("display_name").where("id", "=", m.b.personId).executeTakeFirstOrThrow())).display_name;

  const r = await appUnderTest.inject({ method: "GET", url: "/api/pairs/" + m.pairId, headers: sessionHeader(m.a.sessionToken) });
  const view = PairView.parse(r.json());
  const newest = view.meetings[0];
  const older = view.meetings[1];
  if (newest === undefined || older === undefined) throw new Error("the pair should list two meetings");

  expect(r.statusCode).toBe(200);
  expect(r.headers["content-type"]).toBe("application/json; charset=utf-8");
  expect(new Set([view.creator.displayName, view.joiner?.displayName])).toEqual(new Set([nameA, nameB]));
  expect(view.meetings.length).toBe(2);
  expect(newest.id).toBe(id2);
  expect(newest.questionText).toBe(SECOND_QUESTION);
  expect(older.id).toBe(m.meetingId);
  expect(newest.state).toBe("ready");
  expect(older.state).toBe("ready");
  expect(Date.parse(newest.createdAt)).toBeGreaterThan(Date.parse(older.createdAt));
  expect("queuePosition" in older).toBe(false);
  expect(Math.abs(Date.parse(view.serverNow) - Date.now())).toBeLessThan(5_000);
  expect(r.body).not.toContain("person_id");
  expect(r.body).not.toContain("creator_person_id");
  expect(r.body).not.toContain("token");
});

it("R8.6-T1: the lobby route answers JSON even when the client asks for a stream", async () => {
  const m = await createPairedMeeting(t.db);

  const r = await appUnderTest.inject({ method: "GET", url: "/api/pairs/" + m.pairId, headers: { ...sessionHeader(m.b.sessionToken), accept: "text/event-stream" } });

  expect(r.statusCode).toBe(200);
  expect(String(r.headers["content-type"])).toMatch(/^application\/json/);
  PairView.parse(r.json());
});

it("D53-T1: a lobby poll stamps last_seen_at on the caller's member rows of that pair's ready, queued or running meetings only", async () => {
  const m = await createPairedMeeting(t.db);
  const m2 = await secondMeeting(m);
  await asMeeting(t.db, m2, (trx) => trx.updateTable("meetings").set({ state: "deleted" }).where("id", "=", m2).execute());

  await appUnderTest.inject({ method: "GET", url: "/api/pairs/" + m.pairId, headers: sessionHeader(m.a.sessionToken) });

  const inFirst = await asMeeting(t.db, m.meetingId, (trx) => trx.selectFrom("meeting_members").select(["person_id", "last_seen_at"]).where("meeting_id", "=", m.meetingId).execute());
  const inSecond = await asMeeting(t.db, m2, (trx) => trx.selectFrom("meeting_members").select(["person_id", "last_seen_at"]).where("meeting_id", "=", m2).execute());
  const seenA = inFirst.find((row) => row.person_id === m.a.personId);
  const seenB = inFirst.find((row) => row.person_id === m.b.personId);
  const seenInSecond = inSecond.find((row) => row.person_id === m.a.personId);

  expect(seenA?.last_seen_at).toBeInstanceOf(Date);
  expect(Math.abs(Date.now() - (seenA?.last_seen_at?.getTime() ?? 0))).toBeLessThan(5_000);
  expect(seenB?.last_seen_at).toBeNull();
  expect(seenInSecond?.last_seen_at).toBeNull();
});

it("D54-T2: a lobby poll for a pair you are not in, or with an id that is not a uuid, is 404 not_found", async () => {
  const m = await createPairedMeeting(t.db);

  const other = await appUnderTest.inject({ method: "GET", url: "/api/pairs/" + m.pairId, headers: sessionHeader(c.sessionToken) });
  const notUuid = await appUnderTest.inject({ method: "GET", url: "/api/pairs/abc", headers: sessionHeader(m.a.sessionToken) });

  for (const response of [other, notUuid]) {
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "not_found", message: "This no longer exists or is not yours." });
  }
});
