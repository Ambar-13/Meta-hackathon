import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "kysely";
import { CommittedEvent, PollResponse, TurnDelta } from "@meet-first/contracts";
import { asMeeting, createPairedMeeting, type SeededMeeting } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/app-factory.js";
import { readSse, type SseItem } from "../testing/sse-reader.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerMeetingStreamRoutes } from "./index.js";
import { LISTEN_APPLICATION_NAME } from "./listen-fan-out.js";

let t: Awaited<ReturnType<typeof buildTestApp>>;
let base = "";

type Meeting = Pick<SeededMeeting, "meetingId"> & {
  a: { personId: string; sessionToken: string };
  b: { personId: string; sessionToken: string };
};

// Opens the event stream of one meeting as one person, with the extra request headers the test
// gives.
function openStream(
  meetingId: string,
  token: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return fetch(base + "/api/meetings/" + meetingId + "/events", {
    headers: { cookie: "__Host-session=" + token, accept: "text/event-stream", ...extra },
  });
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
      await trx
        .insertInto("meeting_events")
        .values({
          meeting_id: meetingId,
          seq,
          type: "phase.changed",
          v: 1,
          payload: JSON.stringify({ phase: "open", stepSeq: seq }),
        })
        .execute();
    }
  });
}

// Inserts one running step with the given partial text, so a stream has something to send.
async function insertRunningStep(meetingId: string, text: string): Promise<void> {
  await asMeeting(t.db, meetingId, (trx) =>
    trx
      .insertInto("meeting_steps")
      .values({
        meeting_id: meetingId,
        step_seq: 1,
        side: "a",
        phase: "open",
        state: "running",
        attempt: 1,
        partial_text: text,
        partial_len: text.length,
      })
      .execute(),
  );
}

// Sends one NOTIFY on the meeting channel, as the database would, with the given payload.
async function notify(payload: string): Promise<void> {
  await sql`SELECT pg_notify('meeting_events', ${payload})`.execute(t.db);
}

// The ids of the frames that have one, in order.
function eventIds(items: SseItem[]): string[] {
  return items.flatMap((item) => ("id" in item && item.id !== null ? [item.id] : []));
}

// The turn.delta frames of a read, parsed.
function deltas(items: SseItem[]): ReturnType<typeof TurnDelta.parse>[] {
  return items.flatMap((item) =>
    "event" in item && item.event === "turn.delta" ? [TurnDelta.parse(JSON.parse(item.data))] : [],
  );
}

// The last_seen_at a member row holds, as the meeting's own context reads it.
async function lastSeen(meetingId: string, personId: string): Promise<Date | null> {
  const row = await asMeeting(t.db, meetingId, (trx) =>
    trx
      .selectFrom("meeting_members")
      .select("last_seen_at")
      .where("meeting_id", "=", meetingId)
      .where("person_id", "=", personId)
      .executeTakeFirstOrThrow(),
  );
  return row.last_seen_at;
}

// Waits the given milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The number of LISTEN connections this database holds.
async function listenCount(): Promise<number> {
  const rows = await sql<{
    n: string;
  }>`SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = ${LISTEN_APPLICATION_NAME} AND datname = current_database()`.execute(
    t.db,
  );
  return Number(rows.rows[0]?.n);
}

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerMeetingStreamRoutes] });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const address = t.app.server.address() as AddressInfo;
  base = "http://127.0.0.1:" + String(address.port);
});

afterAll(async () => {
  await t.close();
});

it("D50-T1: the stream answers 200 with exactly D50's three headers and starts with 2,048 bytes of padding", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  const response = await openStream(m.meetingId, m.a.sessionToken);
  const items = await readSse(bodyOf(response), { timeoutMs: 500 });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
  expect(response.headers.get("x-accel-buffering")).toBe("no");
  expect(items).toEqual([{ comment: " ".repeat(2045) }]);
});

it("R8.2-T1: no stream or poll response is compressed, even when the client asks for gzip", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  const response = await openStream(m.meetingId, m.a.sessionToken, {
    "accept-encoding": "gzip, br",
  });
  await readSse(bodyOf(response), { timeoutMs: 200 });
  const poll = await t.app.inject({
    method: "GET",
    url: "/api/meetings/" + m.meetingId + "/events?after=0",
    headers: { ...sessionHeader(m.a.sessionToken), "accept-encoding": "gzip" },
  });

  expect(response.headers.get("content-encoding")).toBeNull();
  expect(poll.statusCode).toBe(200);
  expect(poll.headers["content-encoding"]).toBeUndefined();
});

it("R8.1-T1: a reader that saw seq 3 reconnects with Last-Event-ID 3 and gets 4 first, with no repeat (invariant 18)", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  await insertEvents(m.meetingId, 1, 3);
  const first = await readSse(bodyOf(await openStream(m.meetingId, m.a.sessionToken)), {
    untilSeq: 3,
    timeoutMs: 3000,
  });
  await insertEvents(m.meetingId, 4, 5);
  const second = await readSse(
    bodyOf(await openStream(m.meetingId, m.a.sessionToken, { "last-event-id": "3" })),
    { untilSeq: 5, timeoutMs: 3000 },
  );

  expect(eventIds(first)).toEqual(["1", "2", "3"]);
  expect(eventIds(second)).toEqual(["4", "5"]);
  const parsed = second.flatMap((item) =>
    "event" in item ? [CommittedEvent.parse(JSON.parse(item.data))] : [],
  );
  expect(parsed.map((event) => event.seq)).toEqual([4, 5]);
  for (const event of parsed) {
    expect(event.meetingId).toBe(m.meetingId);
  }
  for (const item of second) {
    if ("event" in item) expect(item.event).toBe("phase.changed");
  }
});

it("D52-T1: the poll form returns exactly the events after the given seq", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  await insertEvents(m.meetingId, 1, 3);
  const seqsAfter = async (after: number): Promise<number[]> => {
    const r = await t.app.inject({
      method: "GET",
      url: "/api/meetings/" + m.meetingId + "/events?after=" + String(after),
      headers: sessionHeader(m.a.sessionToken),
    });
    return PollResponse.parse(r.json()).events.map((event) => event.seq);
  };

  expect(await seqsAfter(1)).toEqual([2, 3]);
  expect(await seqsAfter(0)).toEqual([1, 2, 3]);
  expect(await seqsAfter(3)).toEqual([]);
});

it("D49-T1: ?after= answers JSON PollResponse with the running step's partial text, and null when no step runs", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  await insertEvents(m.meetingId, 1, 2);
  await insertRunningStep(m.meetingId, "Hello there");

  const first = await t.app.inject({
    method: "GET",
    url: "/api/meetings/" + m.meetingId + "/events?after=0",
    headers: sessionHeader(m.a.sessionToken),
  });
  const body = PollResponse.parse(first.json());
  await asMeeting(t.db, m.meetingId, (trx) =>
    trx
      .updateTable("meeting_steps")
      .set({
        state: "done",
        output: JSON.stringify({ text: "Hello there", toolCalls: [], claimsCommitted: 0 }),
        finished_at: new Date(),
      })
      .where("meeting_id", "=", m.meetingId)
      .execute(),
  );
  const second = await t.app.inject({
    method: "GET",
    url: "/api/meetings/" + m.meetingId + "/events?after=0",
    headers: sessionHeader(m.a.sessionToken),
  });

  expect(first.statusCode).toBe(200);
  expect(first.headers["content-type"]).toBe("application/json; charset=utf-8");
  expect(body.v).toBe(1);
  expect(body.events.length).toBe(2);
  expect(body.partial).toEqual({ stepSeq: 1, attempt: 1, side: "a", text: "Hello there" });
  expect(Math.abs(Date.parse(body.serverNow) - Date.now())).toBeLessThan(5000);
  expect(PollResponse.parse(second.json()).partial).toBeNull();
});

it("D49-T2: a bad after value is 400 poll_after_invalid and a bad Last-Event-ID is 400 last_event_id_invalid", async () => {
  const m: Meeting = await createPairedMeeting(t.db);

  const abc = await t.app.inject({
    method: "GET",
    url: "/api/meetings/" + m.meetingId + "/events?after=abc",
    headers: sessionHeader(m.a.sessionToken),
  });
  const leadingZero = await t.app.inject({
    method: "GET",
    url: "/api/meetings/" + m.meetingId + "/events?after=01",
    headers: sessionHeader(m.a.sessionToken),
  });
  const badHeader = await t.app.inject({
    method: "GET",
    url: "/api/meetings/" + m.meetingId + "/events",
    headers: {
      ...sessionHeader(m.a.sessionToken),
      accept: "text/event-stream",
      "last-event-id": "x",
    },
  });

  for (const response of [abc, leadingZero]) {
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "poll_after_invalid",
      message: "The after value must be a whole number. Poll with the last seq you received.",
    });
  }
  expect(badHeader.statusCode).toBe(400);
  expect(badHeader.json()).toEqual({
    code: "last_event_id_invalid",
    message:
      "The Last-Event-ID header must be a whole number. Reconnect without it to replay from the start.",
  });
  expect(badHeader.headers["content-type"]).toBe("application/json; charset=utf-8");
});

it("D47-T1: after the replay the stream sends the running step's partial once, as a turn.delta with offset 0 and no id", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  await insertEvents(m.meetingId, 1, 2);
  await insertRunningStep(m.meetingId, "Hello there");

  const items = await readSse(bodyOf(await openStream(m.meetingId, m.a.sessionToken)), {
    timeoutMs: 1500,
  });
  const frames = items.slice(1);
  const frameDeltas = items.filter(
    (item) => "event" in item && item.event === "turn.delta" && item.id === null,
  );

  expect(eventIds(frames)).toEqual(["1", "2"]);
  expect(frameDeltas.length).toBe(1);
  expect(deltas(items)).toHaveLength(1);
  expect(deltas(items)[0]).toMatchObject({
    v: 1,
    meetingId: m.meetingId,
    stepSeq: 1,
    attempt: 1,
    side: "a",
    offset: 0,
    text: "Hello there",
  });
});

it("D47-T2: a d: NOTIFY sends only the new slice, and a new attempt sends its text from offset 0", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  await insertRunningStep(m.meetingId, "Hello there");
  const reading = readSse(bodyOf(await openStream(m.meetingId, m.a.sessionToken)), {
    timeoutMs: 2500,
  });

  await sleep(400);
  await asMeeting(t.db, m.meetingId, (trx) =>
    trx
      .updateTable("meeting_steps")
      .set({ partial_text: "Hello there, friend", partial_len: 19 })
      .where("meeting_id", "=", m.meetingId)
      .execute(),
  );
  await notify("d:" + m.meetingId + ":1:1:19");
  await sleep(400);
  await asMeeting(t.db, m.meetingId, (trx) =>
    trx
      .updateTable("meeting_steps")
      .set({ attempt: 2, partial_text: "Hi", partial_len: 2 })
      .where("meeting_id", "=", m.meetingId)
      .execute(),
  );
  await notify("d:" + m.meetingId + ":1:2:2");
  const items = await reading;

  const sent = deltas(items).map((delta) => ({
    attempt: delta.attempt,
    offset: delta.offset,
    text: delta.text,
  }));
  expect(sent).toEqual([
    { attempt: 1, offset: 0, text: "Hello there" },
    { attempt: 1, offset: 11, text: ", friend" },
    { attempt: 2, offset: 0, text: "Hi" },
  ]);
});

it("D48-T1: an event committed while the stream is open arrives through LISTEN within 2 s", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  const reading = readSse(bodyOf(await openStream(m.meetingId, m.a.sessionToken)), {
    untilSeq: 1,
    timeoutMs: 3000,
  });

  await sleep(300);
  const insertedAt = Date.now();
  await insertEvents(m.meetingId, 1, 1);
  const items = await reading;

  expect(Date.now() - insertedAt).toBeLessThan(2000);
  expect(eventIds(items)).toEqual(["1"]);
});

it("R8.4-T1: a fourth stream for the same person and meeting ends the oldest, and the other three keep receiving events (D51)", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  const s1 = await openStream(m.meetingId, m.a.sessionToken);
  const s2 = await openStream(m.meetingId, m.a.sessionToken);
  const s3 = await openStream(m.meetingId, m.a.sessionToken);
  const s4 = await openStream(m.meetingId, m.a.sessionToken);

  const started = Date.now();
  const items1 = await readSse(bodyOf(s1), { timeoutMs: 3000 });
  await insertEvents(m.meetingId, 1, 1);
  const items2 = await readSse(bodyOf(s2), { untilSeq: 1, timeoutMs: 3000 });
  const items3 = await readSse(bodyOf(s3), { untilSeq: 1, timeoutMs: 3000 });
  const items4 = await readSse(bodyOf(s4), { untilSeq: 1, timeoutMs: 3000 });

  expect(Date.now() - started).toBeLessThan(2500);
  expect(eventIds(items1)).toEqual([]);
  expect(eventIds(items2)).toEqual(["1"]);
  expect(eventIds(items3)).toEqual(["1"]);
  expect(eventIds(items4)).toEqual(["1"]);
});

it("D56-T1: one LISTEN connection serves every open stream of the process", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  const m2: Meeting = await createPairedMeeting(t.db);
  const streams = [
    await openStream(m.meetingId, m.a.sessionToken),
    await openStream(m.meetingId, m.a.sessionToken),
    await openStream(m.meetingId, m.b.sessionToken),
    await openStream(m2.meetingId, m2.a.sessionToken),
  ];

  const count = await listenCount();
  for (const stream of streams) {
    await readSse(bodyOf(stream), { timeoutMs: 200 });
  }

  expect(count).toBe(1);
});

it("D53-T2: the stream stamps last_seen_at at connect and again with each :hb heartbeat 15 s apart", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  const reading = readSse(bodyOf(await openStream(m.meetingId, m.a.sessionToken)), {
    timeoutMs: 16_500,
  });

  await sleep(1000);
  const t1 = await lastSeen(m.meetingId, m.a.personId);
  const items = await reading;
  const t2 = await lastSeen(m.meetingId, m.a.personId);

  expect(t1).not.toBeNull();
  expect(items.filter((item) => "comment" in item && item.comment === "hb").length).toBe(1);
  const gap = (t2?.getTime() ?? 0) - (t1?.getTime() ?? 0);
  expect(gap).toBeGreaterThanOrEqual(14_000);
  expect(gap).toBeLessThanOrEqual(16_500);
  expect(await lastSeen(m.meetingId, m.b.personId)).toBeNull();
}, 30_000);

it("R8.5-T1: with the LISTEN connection killed, an event still arrives within 10 s, and LISTEN is back within 3 s", async () => {
  const m: Meeting = await createPairedMeeting(t.db);
  const reading = readSse(bodyOf(await openStream(m.meetingId, m.a.sessionToken)), {
    untilSeq: 1,
    timeoutMs: 11_000,
  });

  await sleep(300);
  const killed = await sql<{
    done: boolean;
  }>`SELECT pg_terminate_backend(pid) AS done FROM pg_stat_activity WHERE application_name = ${LISTEN_APPLICATION_NAME} AND datname = current_database()`.execute(
    t.db,
  );
  const insertedAt = Date.now();
  await insertEvents(m.meetingId, 1, 1);
  const items = await reading;
  const arrivedAfter = Date.now() - insertedAt;
  const elapsedBeforeBack = 3000 - arrivedAfter;
  if (elapsedBeforeBack > 0) await sleep(elapsedBeforeBack);

  expect(killed.rows).toEqual([{ done: true }]);
  expect(arrivedAfter).toBeLessThanOrEqual(10_500);
  expect(eventIds(items)).toEqual(["1"]);
  expect(await listenCount()).toBe(1);
}, 30_000);
