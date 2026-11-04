// Unit tests for the event stream reader, run against a fake stream (no server, no database).
import { describe, expect, it } from "vitest";
import { EventStreamReader } from "./event-stream-reader.js";
import { PersonClient, type FetchLike } from "./person-client.js";

const BASE = "http://localhost:3000";
const MEETING = "0f8c7a52-4d3e-4b8a-9c1e-2a3b4c5d6e7f";

// A phase event as the server writes it, with the version and seq the test needs.
function phaseEvent(seq: number, version = 1): Record<string, unknown> {
  return {
    v: version,
    meetingId: MEETING,
    at: "2026-10-26T10:00:00.000Z",
    seq,
    type: "phase.changed",
    phase: "open",
    stepSeq: 1,
  };
}

// One SSE frame: the id line for committed events, none for deltas, then the event and data lines.
function frameFor(event: Record<string, unknown>, withId = true): string {
  const idLine = withId ? `id: ${String(event.seq)}\n` : "";
  return `${idLine}event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
}

// A response whose body holds the given text at once and then stays open until the reader cancels it.
function openStream(text: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// Waits for queued stream work to run, so a test can read what the reader recorded.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe("event stream reader", () => {
  it("R8.1-T1: reader using a fake stream replays with Last-Event-ID 3 and the first event is 4", async () => {
    const all = [1, 2, 3, 4, 5].map((seq) => phaseEvent(seq));
    const sentLastIds: string[] = [];
    let calls = 0;
    const fetchLike: FetchLike = (url, init) => {
      const last = Number(new Headers(init.headers).get("Last-Event-ID") ?? 0);
      sentLastIds.push(String(last));
      calls += 1;
      // The first connection carries seq 1 to 3 only; the reopened one carries everything after the last seq it was given.
      const ceiling = calls === 1 ? 3 : 5;
      const frames = all
        .filter((event) => Number(event.seq) > last && Number(event.seq) <= ceiling)
        .map((event) => frameFor(event));
      return Promise.resolve(openStream(frames.join("")));
    };
    const reader = new EventStreamReader(new PersonClient("A", BASE, fetchLike), MEETING);
    await reader.open();
    await reader.waitFor((event) => "seq" in event && event.seq === 3, 2_000);
    reader.close();
    await reader.open();
    await reader.waitFor((event) => "seq" in event && event.seq === 5, 2_000);
    expect(reader.committed.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(() => {
      reader.assertGapless();
    }).not.toThrow();
    expect(sentLastIds).toEqual(["0", "3"]);
    reader.close();
  });

  it("R8.1-T2: reader using a fake stream fails on a duplicate seq", async () => {
    const frames = [phaseEvent(1), phaseEvent(2), phaseEvent(3), phaseEvent(3)]
      .map((event) => frameFor(event))
      .join("");
    const reader = new EventStreamReader(
      new PersonClient("A", BASE, () => Promise.resolve(openStream(frames))),
      MEETING,
    );
    await reader.open();
    await settle();
    expect(() => {
      reader.assertGapless();
    }).toThrow(/^replay_duplicate seq=3/);
    reader.close();
  });

  it("D47-T1: reader using a fake stream fails when a delta carries an id", async () => {
    const delta = {
      v: 1,
      meetingId: MEETING,
      at: "2026-10-26T10:00:00.000Z",
      type: "turn.delta",
      stepSeq: 1,
      attempt: 1,
      side: "a",
      offset: 0,
      text: "hi",
    };
    const frames = frameFor(delta, true) + frameFor(phaseEvent(1));
    const reader = new EventStreamReader(
      new PersonClient("A", BASE, () => Promise.resolve(openStream(frames))),
      MEETING,
    );
    await reader.open();
    await settle();
    expect(() => {
      reader.assertGapless();
    }).toThrow(/^delta_has_id/);
    reader.close();
  });

  it("R5.11-T1: reader using a fake stream fails on v 2", async () => {
    const frames = frameFor(phaseEvent(1, 2)) + frameFor(phaseEvent(2));
    const reader = new EventStreamReader(
      new PersonClient("A", BASE, () => Promise.resolve(openStream(frames))),
      MEETING,
    );
    await reader.open();
    await settle();
    expect(() => {
      reader.assertGapless();
    }).toThrow(/^event_version_mismatch/);
    reader.close();
  });
});
