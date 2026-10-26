import { expect, it } from "vitest";
import { CommittedEvent, TurnDelta } from "@meet-first/contracts";
import { listenReconnectDelayMs, parseListenPayload } from "./listen-fan-out.js";
import { formatCommittedEvent, formatDelta, HEARTBEAT_LINE, isDeltaNews, makeConnectionLimit, nextDelta, SSE_HEADERS, SSE_PADDING } from "./subscriber.js";

const U = "0f2b9d0c-4f0e-4f7e-9a63-5e8b2b1a9c11";

// What a stream has already sent: its step, attempt and the length it sent.
function sent(stepSeq: number, attempt: number, sentLen: number) {
  return { stepSeq, attempt, sentLen };
}

// A fake open stream that counts how many times it was ended.
type FakeStream = { ended: number; end: () => void };

function fakeStream(): FakeStream {
  const stream: FakeStream = {
    ended: 0,
    end: () => {
      stream.ended += 1;
    },
  };
  return stream;
}

it("D48-T2: parseListenPayload reads e: and d: payloads and gives null for every other form", () => {
  expect(parseListenPayload(`e:${U}:12`)).toEqual({ kind: "event", meetingId: U, seq: 12 });
  expect(parseListenPayload(`e:${U.toUpperCase()}:1`)).toEqual({ kind: "event", meetingId: U, seq: 1 });
  expect(parseListenPayload(`d:${U}:3:2:40`)).toEqual({ kind: "delta", meetingId: U, stepSeq: 3, attempt: 2, len: 40 });
  expect(parseListenPayload(`d:${U}:1:0:0`)).toEqual({ kind: "delta", meetingId: U, stepSeq: 1, attempt: 0, len: 0 });

  const refused = [
    `x:${U}:1`,
    `E:${U}:1`,
    `e:${U}`,
    `e:${U}:1:9`,
    "e:not-a-uuid:1",
    `e:${U}:0`,
    `e:${U}:-1`,
    `e:${U}:1.5`,
    `e:${U}:01`,
    `e:${U}:2147483648`,
    `d:${U}:1:1`,
    `d:${U}:0:1:5`,
    `d:${U}:1:1:5:6`,
    "",
  ];
  for (const payload of refused) {
    expect(parseListenPayload(payload)).toBeNull();
  }
});

it("D47-T3: nextDelta sends the whole text on a new step or attempt, only the new slice when it grows, and nothing otherwise", () => {
  expect(nextDelta(null, null)).toBeNull();
  expect(nextDelta(null, { stepSeq: 1, attempt: 1, side: "a", text: "" })).toBeNull();
  expect(nextDelta(null, { stepSeq: 1, attempt: 1, side: "a", text: "Hello" })).toEqual({ offset: 0, text: "Hello" });
  expect(nextDelta(sent(1, 1, 5), { stepSeq: 1, attempt: 1, side: "a", text: "Hello there" })).toEqual({ offset: 5, text: " there" });
  expect(nextDelta(sent(1, 1, 11), { stepSeq: 1, attempt: 1, side: "a", text: "Hello there" })).toBeNull();
  expect(nextDelta(sent(1, 1, 11), { stepSeq: 1, attempt: 2, side: "a", text: "Hi" })).toEqual({ offset: 0, text: "Hi" });
  expect(nextDelta(sent(1, 1, 11), { stepSeq: 2, attempt: 1, side: "b", text: "Next" })).toEqual({ offset: 0, text: "Next" });
  expect(nextDelta(sent(1, 1, 11), { stepSeq: 1, attempt: 1, side: "a", text: "Hello" })).toBeNull();
  expect(nextDelta(sent(1, 1, 2), { stepSeq: 1, attempt: 1, side: "a", text: "\u{1F600}a" })).toEqual({ offset: 2, text: "a" });

  expect(isDeltaNews(sent(1, 1, 11), { stepSeq: 1, attempt: 1, len: 11 })).toBe(false);
  expect(isDeltaNews(sent(1, 1, 11), { stepSeq: 1, attempt: 1, len: 12 })).toBe(true);
  expect(isDeltaNews(sent(1, 1, 11), { stepSeq: 1, attempt: 2, len: 11 })).toBe(true);
  expect(isDeltaNews(null, { stepSeq: 1, attempt: 1, len: 0 })).toBe(true);
});

it("D47-T4: a delta frame has event turn.delta, one data line and no id line", () => {
  const delta = TurnDelta.parse({ v: 1, type: "turn.delta", meetingId: U, at: "2026-10-27T10:00:00.000Z", stepSeq: 1, attempt: 1, side: "a", offset: 0, text: "Hello" });

  expect(formatDelta(delta)).toBe("event: turn.delta\ndata: " + JSON.stringify(delta) + "\n\n");
  expect(formatDelta(delta)).not.toContain("id:");
});

it("D52-T2: a committed event frame starts with its seq as the id", () => {
  const event = CommittedEvent.parse({ v: 1, type: "phase.changed", meetingId: U, seq: 7, at: "2026-10-27T10:00:00.000Z", phase: "explore", stepSeq: 3 });

  expect(formatCommittedEvent(event)).toBe("id: 7\nevent: phase.changed\ndata: " + JSON.stringify(event) + "\n\n");
});

it("D50-T2: the padding is one comment line of exactly 2,048 bytes, the heartbeat is :hb, and the headers are D50's three", () => {
  expect(Buffer.byteLength(SSE_PADDING, "utf8")).toBe(2048);
  expect(SSE_PADDING.startsWith(":")).toBe(true);
  expect(SSE_PADDING.endsWith("\n\n")).toBe(true);
  expect(SSE_PADDING.slice(1, -2)).toBe(" ".repeat(2045));
  expect(HEARTBEAT_LINE).toBe(":hb\n\n");
  expect(SSE_HEADERS).toEqual({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
});

it("D51-T1: the connection limit keeps 3 streams per key and ends the oldest first (uses fake streams)", () => {
  const streams = [fakeStream(), fakeStream(), fakeStream(), fakeStream(), fakeStream()];
  const [s1, s2, s3, s4, s5] = streams;
  if (s1 === undefined || s2 === undefined || s3 === undefined || s4 === undefined || s5 === undefined) {
    throw new Error("the five fake streams should exist");
  }
  const limit = makeConnectionLimit<FakeStream>(3);

  limit.admit("k", s1);
  limit.admit("k", s2);
  limit.admit("k", s3);
  limit.admit("k", s4);
  expect([s1.ended, s2.ended, s3.ended, s4.ended]).toEqual([1, 0, 0, 0]);
  expect(limit.count("k")).toBe(3);

  limit.release("k", s2);
  expect(limit.count("k")).toBe(2);

  limit.admit("other", s5);
  expect(limit.count("other")).toBe(1);
  expect([s1.ended, s2.ended, s3.ended, s4.ended, s5.ended]).toEqual([1, 0, 0, 0, 0]);

  limit.endAll();
  expect([s2.ended, s3.ended, s4.ended, s5.ended]).toEqual([0, 1, 1, 1]);
  expect(limit.count("k")).toBe(0);
});

it("R8.5-T2: listenReconnectDelayMs waits 1, 2, 4, 8 and 16 s, then 30 s for every later attempt", () => {
  const delays = [0, 1, 2, 3, 4, 5, 6, 7].map((attempt) => listenReconnectDelayMs(attempt));

  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
