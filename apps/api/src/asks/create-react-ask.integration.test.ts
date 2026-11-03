import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskCreateResponse, ErrorBody, PAIR_LIFETIME_HOURS, PAIR_TOKEN_BYTES, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { createPairedMeetingWithTurns, sha256Text, type SeededMeeting } from "@meet-first/db/testing";
import { enqueuedJobs } from "../testing/app-factory.js";
import { buildTestApp } from "../testing/index.js";
import { registerAsksRoutes } from "./index.js";

// The origin every request of this file sends: the test app's own address.
const ORIGIN = "http://localhost:3000";

let t: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  t = await buildTestApp({ routes: [registerAsksRoutes], env: { APP_ORIGIN: ORIGIN } });
});
afterAll(async () => {
  await t.close();
});

// One request: method, URL, the session token of the person making it (none for a request without a session), a JSON payload or a
// raw string payload, and whether to leave out the Origin header.
type Call = { method: "GET" | "POST"; url: string; token?: string; payload?: unknown; withoutOrigin?: boolean };

// The text a payload is sent as: a string as it is, anything else as JSON.
function payloadText(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

// Makes one request through the app's injector and returns the status, the headers and the parsed body.
async function send(call: Call): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (call.withoutOrigin !== true) headers.origin = ORIGIN;
  if (call.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${call.token}`;
  const payload = payloadText(call.payload);
  const response = await t.app.inject({ method: call.method, url: call.url, headers, ...(payload === undefined ? {} : { payload }) });
  return { statusCode: response.statusCode, headers: response.headers, body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown) };
}

// The react text the tests send.
const REACT_TEXT = "Our demo breaks an hour before judging.";
// The reply to every pair that is refused.
const NOT_FOUND = { code: "not_found", message: "This no longer exists or is not yours." };

// Turns one side's friend-ask switch on or off on its approved card, as the card page's sharing part would.
async function setFriendsCanAsk(input: { side: SeededMeeting["a"]; isOn: boolean }): Promise<void> {
  await withPerson(t.db, input.side.personId, (trx) => trx.updateTable("cards").set({ friends_can_ask: input.isOn }).where("id", "=", input.side.cardId).execute());
}

// Makes one more invite pair from creator to joiner and joins it, as POST /api/pairs and the join link would, and returns its id.
async function joinNewPair(input: { creatorId: string; joinerId: string }): Promise<string> {
  const token = randomBytes(PAIR_TOKEN_BYTES).toString("hex");
  const pair = await withPerson(t.db, input.creatorId, (trx) => trx.insertInto("pairs").values({ creator_person_id: input.creatorId, token_hash: sha256Text(token), expires_at: new Date(Date.now() + PAIR_LIFETIME_HOURS * 3_600_000) }).returning("id").executeTakeFirstOrThrow());
  await sql`SELECT pairs_join(${sha256Text(token)}, ${input.joinerId}::uuid) AS pair_id`.execute(t.db);
  return pair.id;
}

// Makes an invite pair that nobody joined, and returns its id.
async function makeUnjoinedPair(creatorId: string): Promise<string> {
  const pair = await withPerson(t.db, creatorId, (trx) => trx.insertInto("pairs").values({ creator_person_id: creatorId, token_hash: sha256Text(randomBytes(PAIR_TOKEN_BYTES).toString("hex")), expires_at: new Date(Date.now() + PAIR_LIFETIME_HOURS * 3_600_000) }).returning("id").executeTakeFirstOrThrow());
  return pair.id;
}

// Lists side b with its first two items public, starts a directory meeting from side a, and returns that meeting's pair id.
async function makeDirectoryPair(m: SeededMeeting): Promise<string> {
  const listing = await withPerson(t.db, m.b.personId, async (trx) => {
    await trx.updateTable("card_items").set({ is_public: true }).where("card_id", "=", m.b.cardId).where("position", "<=", 2).execute();
    return trx.insertInto("directory_listings").values({ person_id: m.b.personId, card_id: m.b.cardId, line: "I keep plans loose." }).returning("id").executeTakeFirstOrThrow();
  });
  return withPerson(t.db, m.a.personId, async (trx) => {
    const created = await sql<{ meeting_id: string }>`SELECT directory_meeting_create(${listing.id}::uuid, ${m.a.personId}::uuid, ${m.a.cardId}::uuid, NULL::int, ${"How would we split the work?"}::text, true, 'help'::text, 10::int) AS meeting_id`.execute(trx);
    const meeting = await trx.selectFrom("meetings").select("pair_id").where("id", "=", created.rows[0]?.meeting_id ?? "").executeTakeFirstOrThrow();
    return meeting.pair_id;
  });
}

// The person's stored asks of one mode.
async function countAsks(input: { personId: string; mode: "help" | "react" }): Promise<number> {
  const rows = await withPerson(t.db, input.personId, (trx) => trx.selectFrom("persona_asks").select("id").where("person_id", "=", input.personId).where("mode", "=", input.mode).execute());
  return rows.length;
}

// Sends one react ask as a person for a pair.
async function sendReact(input: { token: string; pairId: string; text?: string }): Promise<{ statusCode: number; body: unknown }> {
  return send({ method: "POST", url: routes.asks.createAsk.path, token: input.token, payload: { mode: "react", pairId: input.pairId, text: input.text ?? REACT_TEXT } });
}

describe("POST /api/asks, friend asks", () => {
  it("W6-ASKA-T10 (design section 6, P3): a react ask to an invite friend who turned on friend asks is stored with the pair and the friend's display name, and run_ask is enqueued", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await setFriendsCanAsk({ side: m.b, isOn: true });
    await setFriendsCanAsk({ side: m.a, isOn: true });

    const first = await sendReact({ token: m.a.sessionToken, pairId: m.pairId, text: "  " + REACT_TEXT + "  " });

    expect(first.statusCode).toBe(201);
    const { askId } = AskCreateResponse.parse(first.body);
    const rowAsA = await withPerson(t.db, m.a.personId, (trx) => trx.selectFrom("persona_asks").select(["person_id", "mode", "pair_id", "text", "state", "about_name", "refused_reason"]).where("id", "=", askId).executeTakeFirstOrThrow());
    expect(rowAsA).toEqual({ person_id: m.a.personId, mode: "react", pair_id: m.pairId, text: REACT_TEXT, state: "checking", about_name: "Test B", refused_reason: null });
    expect(enqueuedJobs(t.app).at(-1)).toEqual({ name: "run_ask", payload: { askId, personId: m.a.personId } });

    const second = await sendReact({ token: m.b.sessionToken, pairId: m.pairId });

    expect(second.statusCode).toBe(201);
    const secondId = AskCreateResponse.parse(second.body).askId;
    const rowAsB = await withPerson(t.db, m.b.personId, (trx) => trx.selectFrom("persona_asks").select(["about_name"]).where("id", "=", secondId).executeTakeFirstOrThrow());
    expect(rowAsB.about_name).toBe("Test A");
  });

  it("W6-ASKA-T11 (design section 6, P3): a friend who has not turned on friend asks gives 409 friend_asks_off with their name, and nothing is stored", async () => {
    const m = await createPairedMeetingWithTurns(t.db);

    const response = await sendReact({ token: m.a.sessionToken, pairId: m.pairId });

    expect(response.statusCode).toBe(409);
    expect(ErrorBody.parse(response.body)).toEqual({ code: "friend_asks_off", message: "Test B has not turned on friend asks." });
    expect(await countAsks({ personId: m.a.personId, mode: "react" })).toBe(0);
    expect(enqueuedJobs(t.app).some((job) => job.name === "run_ask" && (job.payload as { personId: string }).personId === m.a.personId)).toBe(false);
  });

  it("W6-ASKA-T12 (design section 6, P3): a pair that is not the caller's, not joined, made by the directory, unknown, or not the latest invite pair with that friend gives 404 not_found", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await setFriendsCanAsk({ side: m.b, isOn: true });
    const other = await createPairedMeetingWithTurns(t.db);
    const unjoined = await makeUnjoinedPair(m.a.personId);
    const viaDirectory = await makeDirectoryPair(m);
    const newer = await joinNewPair({ creatorId: m.a.personId, joinerId: m.b.personId });

    for (const pairId of [other.pairId, unjoined, viaDirectory, randomUUID(), m.pairId]) {
      const response = await sendReact({ token: m.a.sessionToken, pairId });
      expect(response.statusCode).toBe(404);
      expect(ErrorBody.parse(response.body)).toEqual(NOT_FOUND);
    }
    const accepted = await sendReact({ token: m.a.sessionToken, pairId: newer });
    expect(accepted.statusCode).toBe(201);
    expect(await countAsks({ personId: m.a.personId, mode: "react" })).toBe(1);
  });

  it("W6-ASKA-T13 (design section 5): the twenty-first react ask of a UTC day is 429 react_daily_cap, and help searches and react asks are counted apart", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await setFriendsCanAsk({ side: m.b, isOn: true });
    await withPerson(t.db, m.a.personId, (trx) => trx.insertInto("persona_asks").values(Array.from({ length: 20 }, () => ({ person_id: m.a.personId, mode: "react" as const, pair_id: m.pairId, text: "Seeded friend ask", about_name: "Test B" }))).execute());

    const blocked = await sendReact({ token: m.a.sessionToken, pairId: m.pairId });
    expect(blocked.statusCode).toBe(429);
    expect(ErrorBody.parse(blocked.body)).toEqual({ code: "react_daily_cap", message: "You have sent today's friend asks. Try again tomorrow." });
    const help = await send({ method: "POST", url: routes.asks.createAsk.path, token: m.a.sessionToken, payload: { mode: "help", text: REACT_TEXT } });
    expect(help.statusCode).toBe(201);

    const n = await createPairedMeetingWithTurns(t.db);
    await setFriendsCanAsk({ side: n.b, isOn: true });
    await withPerson(t.db, n.a.personId, (trx) => trx.insertInto("persona_asks").values(Array.from({ length: 5 }, () => ({ person_id: n.a.personId, mode: "help" as const, text: "Seeded help search" }))).execute());
    const nReact = await sendReact({ token: n.a.sessionToken, pairId: n.pairId });
    expect(nReact.statusCode).toBe(201);

    expect(await countAsks({ personId: m.a.personId, mode: "react" })).toBe(20);
    expect(await countAsks({ personId: m.a.personId, mode: "help" })).toBe(1);
    expect(await countAsks({ personId: n.a.personId, mode: "react" })).toBe(1);
  });

  it("W6-ASKA-T14 (A7): without a session POST /api/asks is 401 session_missing, and without the app's Origin it is 403 origin_mismatch", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await setFriendsCanAsk({ side: m.b, isOn: true });

    const noSession = await send({ method: "POST", url: routes.asks.createAsk.path, payload: { mode: "react", pairId: m.pairId, text: REACT_TEXT } });
    expect(noSession.statusCode).toBe(401);
    expect(ErrorBody.parse(noSession.body)).toEqual({ code: "session_missing", message: "Sign in again from the start page." });

    const noOrigin = await send({ method: "POST", url: routes.asks.createAsk.path, token: m.a.sessionToken, payload: { mode: "react", pairId: m.pairId, text: REACT_TEXT }, withoutOrigin: true });
    expect(noOrigin.statusCode).toBe(403);
    expect(ErrorBody.parse(noOrigin.body)).toEqual({ code: "origin_mismatch", message: "Open the app from its own address and try again." });
    expect(await countAsks({ personId: m.a.personId, mode: "react" })).toBe(0);
  });
});
