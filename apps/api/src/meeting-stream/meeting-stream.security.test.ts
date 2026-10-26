import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CommittedEvent } from "@meet-first/contracts";
import { asMeeting, asPerson, createPairedMeeting, type SeededMeeting } from "@meet-first/db/testing";
import { buildTestApp, testLogLines } from "../testing/app-factory.js";
import { readSse, type SseItem } from "../testing/sse-reader.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { meetingStreamRoutes } from "./index.js";
import { makeStreamReads } from "./replay-and-poll.js";
import { createSubscriber, STREAM_TIMING } from "./subscriber.js";

// The session re-check interval these tests use, shorter than the 15 s real one, so a signed-out stream ends quickly.
const SESSION_CHECK_MS = 200;

let t: Awaited<ReturnType<typeof buildTestApp>>;
let base = "";

type Meeting = Pick<SeededMeeting, "meetingId"> & { a: { personId: string; sessionToken: string }; b: { personId: string; sessionToken: string } };

// Opens the event stream of one meeting as one person.
function openStream(meetingId: string, token: string): Promise<Response> {
  return fetch(base + "/api/meetings/" + meetingId + "/events", { headers: { cookie: "__Host-session=" + token, accept: "text/event-stream" } });
}

// The body of a stream response; a missing body is a test failure.
function bodyOf(response: Response): ReadableStream<Uint8Array> {
  if (response.body === null) throw new Error("the response has no body");
  return response.body;
}

// Inserts the committed events from fromSeq to toSeq, one per seq, as the meeting's own context.
async function insertEvents(meetingId: string, fromSeq: number, toSeq: number): Promise<void> {
  await asMeeting(t.db, meetingId, async (trx) => {
    for (let seq = fromSeq; seq <= toSeq; seq += 1) {
      await trx.insertInto("meeting_events").values({ meeting_id: meetingId, seq, type: "phase.changed", v: 1, payload: JSON.stringify({ phase: "open", stepSeq: seq }) }).execute();
    }
  });
}

// How many stream_session_ended lines the app has written so far.
function endedLines(): number {
  return testLogLines(t.app).filter((line) => line.includes("stream_session_ended")).length;
}

// Waits the given milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The ids of the event frames that have one, in order.
function eventIds(items: SseItem[]): string[] {
  return items.flatMap((item) => ("id" in item && item.id !== null ? [item.id] : []));
}

beforeAll(async () => {
  t = await buildTestApp({ routes: [meetingStreamRoutes({ ...STREAM_TIMING, sessionCheckMs: SESSION_CHECK_MS })] });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const address = t.app.server.address() as AddressInfo;
  base = "http://127.0.0.1:" + String(address.port);
});

afterAll(async () => {
  await t.close();
});

it("R8.7-T1: a stream woken for a meeting its viewer is not in reads zero rows and writes nothing", async () => {
  const mX: Meeting = await createPairedMeeting(t.db);
  const mY: Meeting = await createPairedMeeting(t.db);
  await insertEvents(mY.meetingId, 1, 3);
  const reads = makeStreamReads({ db: t.db, now: () => new Date() });
  const lines: string[] = [];
  const sub = createSubscriber({
    personId: mX.a.personId,
    meetingId: mY.meetingId,
    lastSeq: 0,
    reads,
    write: (chunk) => {
      lines.push(chunk);
    },
    end: () => undefined,
    now: () => new Date(),
    log: t.app.log,
    timing: { heartbeatMs: 60_000, safetyPollMs: 60_000, sessionCheckMs: 60_000 },
    sessionStillValid: () => Promise.resolve(true),
  });

  sub.wake({ kind: "event", meetingId: mY.meetingId, seq: 3 });
  sub.wake({ kind: "poll" });
  await sub.whenIdle();
  sub.stop();

  expect(lines.length).toBe(0);
  expect(await reads.readEventsAfter(mX.a.personId, mY.meetingId, 0)).toHaveLength(0);
  expect(await reads.readEventsAfter(mY.a.personId, mY.meetingId, 0)).toHaveLength(3);
  expect(await reads.readMembership(mX.a.personId, mY.meetingId)).toBeNull();
});

it("R8.7-T2: a NOTIFY for meeting Y sends nothing on a stream of meeting X", async () => {
  const mX: Meeting = await createPairedMeeting(t.db);
  const mY: Meeting = await createPairedMeeting(t.db);
  const reading = readSse(bodyOf(await openStream(mX.meetingId, mX.a.sessionToken)), { untilSeq: 1, timeoutMs: 3000 });

  await sleep(300);
  await insertEvents(mY.meetingId, 1, 2);
  await sleep(500);
  await insertEvents(mX.meetingId, 1, 1);
  const items = await reading;

  const events = items.flatMap((item) => ("event" in item ? [CommittedEvent.parse(JSON.parse(item.data))] : []));
  expect(eventIds(items)).toEqual(["1"]);
  expect(events.length).toBe(1);
  expect(events[0]?.meetingId).toBe(mX.meetingId);
});

it("R8.7-T3: opening the stream or the poll of a meeting you are not in is 404 not_found, with no stream started", async () => {
  const mX: Meeting = await createPairedMeeting(t.db);
  const mY: Meeting = await createPairedMeeting(t.db);

  const stream = await t.app.inject({ method: "GET", url: "/api/meetings/" + mY.meetingId + "/events", headers: { ...sessionHeader(mX.a.sessionToken), accept: "text/event-stream" } });
  const poll = await t.app.inject({ method: "GET", url: "/api/meetings/" + mY.meetingId + "/events?after=0", headers: sessionHeader(mX.a.sessionToken) });
  const notUuid = await t.app.inject({ method: "GET", url: "/api/meetings/abc/events", headers: { ...sessionHeader(mX.a.sessionToken), accept: "text/event-stream" } });

  for (const response of [stream, poll, notUuid]) {
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "not_found", message: "This no longer exists or is not yours." });
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
  }
});

it("R8.7-T4: a deleted meeting's stream is 404 not_found for its own members", async () => {
  const mZ: Meeting = await createPairedMeeting(t.db);
  await asMeeting(t.db, mZ.meetingId, (trx) => trx.updateTable("meetings").set({ state: "deleted" }).where("id", "=", mZ.meetingId).execute());

  const r = await t.app.inject({ method: "GET", url: "/api/meetings/" + mZ.meetingId + "/events", headers: { ...sessionHeader(mZ.a.sessionToken), accept: "text/event-stream" } });

  expect(r.statusCode).toBe(404);
  expect(r.json()).toMatchObject({ code: "not_found" });
});

it("A7-T10: an open stream ends within two session checks after its person's sessions are deleted (invariant 21)", async () => {
  const endedBefore = endedLines();
  const m: Meeting = await createPairedMeeting(t.db);
  const response = await openStream(m.meetingId, m.a.sessionToken);
  await sleep(100);
  await asPerson(t.db, m.a.personId, (trx) => trx.deleteFrom("sessions").where("person_id", "=", m.a.personId).execute());
  const deletedAt = Date.now();

  const items = await readSse(bodyOf(response), { timeoutMs: 3000 });
  const elapsed = Date.now() - deletedAt;

  // Two check intervals, plus 200 ms for the database reads and the close.
  expect(elapsed).toBeLessThan(2 * SESSION_CHECK_MS + 200);
  expect(items.filter((item) => "id" in item && item.id !== null)).toEqual([]);
  expect(endedLines() - endedBefore).toBe(1);
});

it("R8.7-T5: an open stream ends within two session checks after its meeting is set to deleted (review row 25)", async () => {
  const endedBefore = endedLines();
  const m: Meeting = await createPairedMeeting(t.db);
  const response = await openStream(m.meetingId, m.a.sessionToken);
  await sleep(100);
  await asMeeting(t.db, m.meetingId, (trx) => trx.updateTable("meetings").set({ state: "deleted" }).where("id", "=", m.meetingId).execute());
  const deletedAt = Date.now();

  const items = await readSse(bodyOf(response), { timeoutMs: 3000 });
  const elapsed = Date.now() - deletedAt;

  // Two check intervals, plus 200 ms for the database reads and the close.
  expect(elapsed).toBeLessThan(2 * SESSION_CHECK_MS + 200);
  expect(items.filter((item) => "id" in item && item.id !== null)).toEqual([]);
  expect(endedLines() - endedBefore).toBe(1);
});
