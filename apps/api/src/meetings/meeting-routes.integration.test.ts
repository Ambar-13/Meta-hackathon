import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { CommittedEvent, CURATED_QUESTIONS, MeetingCreateResponse, MeetingReadyResponse, MeetingStartResponse, MeetingView, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { makeDatabase, withMeeting, withPerson, type Database } from "@meet-first/db";
import { asPerson, createPairedMeeting, readTestDatabaseUrls } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { registerMeetingsRoutes } from "./index.js";

// The origin every test request sends, the origin the test app allows (TEST_APP_ORIGIN).
const ORIGIN = "http://localhost:3000";

// The seeded meeting of one test.
type Seeded = Awaited<ReturnType<typeof createPairedMeeting>>;
// One person of a seeded meeting, as the requests name them.
type Person = Seeded["a"];

let kit: Awaited<ReturnType<typeof buildTestApp>>;
let workerDb: Kysely<Database>;
let m: Seeded;
let started: string[];

beforeAll(async () => {
  kit = await buildTestApp({ routes: [registerMeetingsRoutes], env: { APP_ORIGIN: ORIGIN, MAX_CONCURRENT_MEETINGS: 1 } });
  workerDb = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, 2);
});

beforeEach(async () => {
  m = await createPairedMeeting(kit.db, { questionId: 3 });
  started = [m.meetingId];
});

afterEach(async () => {
  for (const id of started) {
    await withMeeting(workerDb, id, (trx) => trx.updateTable("meetings").set({ state: "deleted" }).where("id", "=", id).execute());
  }
});

afterAll(async () => {
  await workerDb.destroy();
  await kit.close();
});

// The headers of one request made as this person: the session cookie, the app's origin and the JSON content type.
function headersOf(person: Person): Record<string, string> {
  return { cookie: SESSION_COOKIE + "=" + person.sessionToken, origin: ORIGIN, "content-type": "application/json" };
}

// The URL of a route with its :id filled in.
function pathOf(route: { path: string }, id: string): string {
  return route.path.replace(":id", id);
}

// One request: its method, its URL, the person who makes it, and an optional JSON payload.
type Call = { method: "GET" | "POST"; url: string; person: Person; payload?: unknown };

// Makes one request through the app's injector, and returns the response.
async function request(call: Call) {
  return kit.app.inject({ method: call.method, url: call.url, headers: headersOf(call.person), ...(call.payload === undefined ? {} : { payload: JSON.stringify(call.payload) }) });
}

// Makes a meeting ready for a start: the prefixes stored and both go-aheads recorded, with nobody online.
async function prepare(meetingId: string): Promise<void> {
  const now = new Date();
  await withMeeting(workerDb, meetingId, (trx) => trx.updateTable("meeting_members")
    .set({ ready_at: now, last_seen_at: now, frozen_prefix: "prefix for tests", frozen_prefix_tokens: 4 }).where("meeting_id", "=", meetingId).execute());
}

// Clears the go-aheads, presence and prefixes of a meeting, so each test sets only what it needs.
async function reset(meetingId: string): Promise<void> {
  await withMeeting(workerDb, meetingId, (trx) => trx.updateTable("meeting_members")
    .set({ ready_at: null, last_seen_at: null, frozen_prefix: null, frozen_prefix_tokens: null }).where("meeting_id", "=", meetingId).execute());
}

// The state of a meeting row.
async function stateOf(meetingId: string): Promise<string> {
  const row = await withMeeting(workerDb, meetingId, (trx) => trx.selectFrom("meetings").select("state").where("id", "=", meetingId).executeTakeFirstOrThrow());
  return row.state;
}

// The step rows of a meeting.
async function stepsOf(meetingId: string) {
  return withMeeting(workerDb, meetingId, (trx) => trx.selectFrom("meeting_steps").selectAll().where("meeting_id", "=", meetingId).execute());
}

// Every committed event of a meeting, in seq order, as the contract reads them.
async function eventsOf(meetingId: string): Promise<CommittedEvent[]> {
  const rows = await withMeeting(workerDb, meetingId, (trx) => trx.selectFrom("meeting_events")
    .select(["meeting_id", "seq", "type", "v", "payload", "created_at"]).where("meeting_id", "=", meetingId).orderBy("seq").execute());
  return rows.map((row) => CommittedEvent.parse({ ...row.payload, v: row.v, type: row.type, meetingId: row.meeting_id, seq: row.seq, at: new Date(row.created_at).toISOString() }));
}

// The display name of a person, read through the meeting context.
async function nameOf(meetingId: string, personId: string): Promise<string> {
  const row = await withMeeting(workerDb, meetingId, (trx) => trx.selectFrom("people").select("display_name").where("id", "=", personId).executeTakeFirstOrThrow());
  return row.display_name;
}

it("R10.5-T3: a curated question gives 201 and a checked meeting with both members", async () => {
  const created = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.a, payload: { questionId: 3, cardId: m.a.cardId } });
  expect(created.statusCode).toBe(201);
  const { meetingId } = MeetingCreateResponse.parse(created.json());
  started.push(meetingId);
  const response = await request({ method: "GET", url: pathOf(routes.meetings.readMeeting, meetingId), person: m.a });
  expect(response.statusCode).toBe(200);
  const view = MeetingView.parse(response.json());
  expect(view).toMatchObject({ state: "ready", questionChecked: true, questionText: CURATED_QUESTIONS[2]?.text, questionKind: CURATED_QUESTIONS[2]?.kind, viewerSide: "a" });
  expect(view.members.map((member) => member.side)).toEqual(["a", "b"]);
  expect(view.members.map((member) => member.ready)).toEqual([false, false]);
  expect(view.members.map((member) => member.connected)).toEqual([false, false]);
  expect(view.members[0]?.displayName).toBe(await nameOf(meetingId, m.a.personId));
  expect(view.members[1]?.displayName).toBe(await nameOf(meetingId, m.b.personId));
});

it("R10.5-T4: a free-text question gives 201 and an unchecked meeting", async () => {
  const created = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.a, payload: { freeText: "  Should we split the work by strengths or by interest?  ", cardId: m.a.cardId } });
  expect(created.statusCode).toBe(201);
  const { meetingId } = MeetingCreateResponse.parse(created.json());
  started.push(meetingId);
  const view = MeetingView.parse((await request({ method: "GET", url: pathOf(routes.meetings.readMeeting, meetingId), person: m.a })).json());
  expect(view.questionChecked).toBe(false);
  expect(view.questionText).toBe("Should we split the work by strengths or by interest?");
  expect(view.questionKind).toBe("situation");
});

it("R9.3-T1: a meeting on a pair nobody joined is refused with 409 pair_not_joined", async () => {
  const pair = await withPerson(kit.db, m.a.personId, (trx) => trx.insertInto("pairs").values({
    creator_person_id: m.a.personId, token_hash: randomBytes(32), expires_at: new Date(Date.now() + 86_400_000),
  }).returning("id").executeTakeFirstOrThrow());
  const response = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, pair.id), person: m.a, payload: { questionId: 3, cardId: m.a.cardId } });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ code: "pair_not_joined", message: "The other person has not joined this pair yet. Send them the invite link again." });
});

it("D60-T1: a sixth meeting in one UTC day is refused with 429 meeting_daily_cap", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.a, payload: { questionId: 3, cardId: m.a.cardId } });
    statuses.push(response.statusCode);
    if (response.statusCode === 201) started.push(MeetingCreateResponse.parse(response.json()).meetingId);
  }
  expect(statuses).toEqual([201, 201, 201, 201]);
  const refused = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.a, payload: { questionId: 3, cardId: m.a.cardId } });
  expect(refused.statusCode).toBe(429);
  expect(refused.json()).toMatchObject({ code: "meeting_daily_cap" });
});

it("W5-DIR-T12: being met as a listed persona does not use up a person's own five meetings a day", async () => {
  // The seeded meeting is the first of today's five; four more fill both people's day.
  const meetingIds = [m.meetingId];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.a, payload: { questionId: 3, cardId: m.a.cardId } });
    meetingIds.push(MeetingCreateResponse.parse(response.json()).meetingId);
  }
  started.push(...meetingIds.slice(1));
  for (const meetingId of meetingIds) {
    await withMeeting(workerDb, meetingId, (trx) => trx.updateTable("meeting_members").set({ public_only: true }).where("meeting_id", "=", meetingId).where("side", "=", "b").execute());
  }
  const own = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.b, payload: { questionId: 3, cardId: m.b.cardId } });
  expect(own.statusCode).toBe(201);
  started.push(MeetingCreateResponse.parse(own.json()).meetingId);
  const capped = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.a, payload: { questionId: 3, cardId: m.a.cardId } });
  expect(capped.statusCode).toBe(429);
});

it("D60-T7: a meeting request waits while another transaction holds the creator's person row", async () => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // FOR NO KEY UPDATE: the membership insert's foreign-key check does not wait on it, so only the route's own lock can.
  const holder = asPerson(kit.db, m.a.personId, async (trx) => {
    await trx.selectFrom("people").select("id").where("id", "=", m.a.personId).forNoKeyUpdate().execute();
    await held;
  });

  const pending = request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.a, payload: { questionId: 3, cardId: m.a.cardId } });
  const early = await Promise.race([pending.then(() => "finished"), new Promise((resolve) => setTimeout(() => { resolve("waiting"); }, 300))]);
  release();
  await holder;
  const response = await pending;
  if (response.statusCode === 201) started.push(MeetingCreateResponse.parse(response.json()).meetingId);

  expect(early).toBe("waiting");
  expect(response.statusCode).toBe(201);
});

it("R5.3-T3: start is refused in order until both gave their go-ahead and both prefixes exist, and needs nobody online", async () => {
  const id = m.meetingId;
  const start = pathOf(routes.meetings.start, id);
  const ready = pathOf(routes.meetings.ready, id);
  await reset(id);
  const first = await request({ method: "POST", url: start, person: m.a });
  expect(first.json()).toMatchObject({ code: "meeting_not_ready" });
  expect(first.statusCode).toBe(409);
  expect((await request({ method: "POST", url: ready, person: m.a })).json()).toEqual(MeetingReadyResponse.parse({ ready: true }));
  expect((await request({ method: "POST", url: start, person: m.a })).json()).toMatchObject({ code: "meeting_not_ready" });
  expect((await request({ method: "POST", url: ready, person: m.b })).json()).toEqual(MeetingReadyResponse.parse({ ready: true }));
  const preparing = await request({ method: "POST", url: start, person: m.a });
  expect(preparing.json()).toMatchObject({ code: "meeting_preparing" });
  expect(await stateOf(id)).toBe("ready");
  await withMeeting(workerDb, id, (trx) => trx.updateTable("meeting_members").set({ frozen_prefix: "prefix for tests", frozen_prefix_tokens: 4 }).where("meeting_id", "=", id).execute());
  const running = await request({ method: "POST", url: start, person: m.b });
  expect(MeetingStartResponse.parse(running.json())).toEqual({ state: "running" });
  const meetingRow = await withMeeting(workerDb, id, (trx) => trx.selectFrom("meeting_members").select("last_seen_at").where("meeting_id", "=", id).execute());
  expect(meetingRow.every((row) => row.last_seen_at === null)).toBe(true);
  expect((await request({ method: "POST", url: start, person: m.a })).json()).toMatchObject({ code: "meeting_already_started" });
});

it("R5.3-T4: the second go-ahead starts a prepared meeting by itself", async () => {
  const id = m.meetingId;
  await reset(id);
  await withMeeting(workerDb, id, (trx) => trx.updateTable("meeting_members").set({ frozen_prefix: "prefix for tests", frozen_prefix_tokens: 4 }).where("meeting_id", "=", id).execute());
  expect((await request({ method: "POST", url: pathOf(routes.meetings.ready, id), person: m.a })).json()).toEqual({ ready: true });
  expect(await stateOf(id)).toBe("ready");
  expect(await stepsOf(id)).toHaveLength(0);
  expect((await request({ method: "POST", url: pathOf(routes.meetings.ready, id), person: m.b })).json()).toEqual({ ready: true });
  expect(await stateOf(id)).toBe("running");
  const steps = await stepsOf(id);
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({ step_seq: 1, side: "a", phase: "open", state: "pending" });
  const events = await eventsOf(id);
  expect(events.slice(0, 2).map((event) => event.type)).toEqual(["meeting.started", "phase.changed"]);
  expect(events.slice(0, 2).map((event) => event.seq)).toEqual([1, 2]);
});

it("R5.3-T1: 50 parallel starts give one running meeting, one step row and events seq 1 and 2", async () => {
  await prepare(m.meetingId);
  const responses = await Promise.all(Array.from({ length: 50 }, (value, index) => request({ method: "POST", url: pathOf(routes.meetings.start, m.meetingId), person: index % 2 === 0 ? m.a : m.b })));
  const running = responses.filter((response) => response.statusCode === 200);
  const refused = responses.filter((response) => response.statusCode === 409);
  expect(running).toHaveLength(1);
  expect(refused).toHaveLength(49);
  for (const response of refused) expect(response.json()).toMatchObject({ code: "meeting_already_started" });
  const steps = await stepsOf(m.meetingId);
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({ step_seq: 1, side: "a", phase: "open", state: "pending" });
  const events = await eventsOf(m.meetingId);
  expect(events[0]).toMatchObject({ type: "meeting.started", seq: 1, v: 1 });
  expect(events[1]).toMatchObject({ type: "phase.changed", seq: 2, phase: "open", stepSeq: 1 });
  if (events[0]?.type !== "meeting.started") throw new Error("The first event is not meeting.started.");
  expect(events[0].members).toHaveLength(2);
  expect(events[0].question).toBe(CURATED_QUESTIONS[2]?.text);
  const meeting = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meetings").select(["phase", "current_step_seq", "started_at", "ends_at"]).where("id", "=", m.meetingId).executeTakeFirstOrThrow());
  expect(meeting.phase).toBe("open");
  expect(meeting.current_step_seq).toBe(1);
  expect(meeting.ends_at !== null && meeting.started_at !== null ? meeting.ends_at.getTime() - meeting.started_at.getTime() : -1).toBe(600_000);
});

it("R5.9-T1: when no running slot is free a start is queued with position 1", async () => {
  const m2 = await createPairedMeeting(kit.db, { questionId: 3 });
  started.push(m2.meetingId);
  await prepare(m2.meetingId);
  const first = await request({ method: "POST", url: pathOf(routes.meetings.start, m2.meetingId), person: m2.a });
  expect(first.json()).toEqual({ state: "running" });
  await prepare(m.meetingId);
  const queued = await request({ method: "POST", url: pathOf(routes.meetings.start, m.meetingId), person: m.a });
  expect(queued.json()).toEqual({ state: "queued", queuePosition: 1 });
  const view = MeetingView.parse((await request({ method: "GET", url: pathOf(routes.meetings.readMeeting, m.meetingId), person: m.a })).json());
  expect(view).toMatchObject({ state: "queued", queuePosition: 1 });
  expect(await stepsOf(m.meetingId)).toHaveLength(0);
});

it("D53-T3: when the pair's joiner creates the meeting, the view puts each name on its own side and gives each caller its side", async () => {
  const created = await request({ method: "POST", url: pathOf(routes.meetings.createMeeting, m.pairId), person: m.b, payload: { questionId: 3, cardId: m.b.cardId } });
  expect(created.statusCode).toBe(201);
  const { meetingId } = MeetingCreateResponse.parse(created.json());
  started.push(meetingId);
  const asB = MeetingView.parse((await request({ method: "GET", url: pathOf(routes.meetings.readMeeting, meetingId), person: m.b })).json());
  expect(asB.viewerSide).toBe("a");
  expect(asB.members[0]?.displayName).toBe(await nameOf(meetingId, m.b.personId));
  expect(asB.members[1]?.displayName).toBe(await nameOf(meetingId, m.a.personId));
  const asA = MeetingView.parse((await request({ method: "GET", url: pathOf(routes.meetings.readMeeting, meetingId), person: m.a })).json());
  expect(asA.viewerSide).toBe("b");
  expect(asA.members[0]?.displayName).toBe(asB.members[0]?.displayName);
  expect(asA.members[1]?.displayName).toBe(asB.members[1]?.displayName);
});

it("D53-T2: the meeting view reports presence within 30 s and does not touch last_seen_at", async () => {
  const now = Date.now();
  await withMeeting(workerDb, m.meetingId, (trx) => trx.updateTable("meeting_members").set({ last_seen_at: new Date(now - 10_000) })
    .where("meeting_id", "=", m.meetingId).where("side", "=", "a").execute());
  await withMeeting(workerDb, m.meetingId, (trx) => trx.updateTable("meeting_members").set({ last_seen_at: new Date(now - 40_000) })
    .where("meeting_id", "=", m.meetingId).where("side", "=", "b").execute());
  const before = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meeting_members").select(["side", "last_seen_at"]).where("meeting_id", "=", m.meetingId).orderBy("side").execute());
  const view = MeetingView.parse((await request({ method: "GET", url: pathOf(routes.meetings.readMeeting, m.meetingId), person: m.b })).json());
  expect(view.members[0]?.connected).toBe(true);
  expect(view.members[1]?.connected).toBe(false);
  expect(Number.isNaN(Date.parse(view.serverNow))).toBe(false);
  const after = await withMeeting(workerDb, m.meetingId, (trx) => trx.selectFrom("meeting_members").select(["side", "last_seen_at"]).where("meeting_id", "=", m.meetingId).orderBy("side").execute());
  expect(after).toEqual(before);
});
