import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openMeetingFeed, parseSseText, type FeedStatus, type MeetingFeed, type MeetingFeedOptions } from "./sse-client.js";
import { fakeMeetingServer, sseFrame, type FakeMeetingServer, type FakeStream } from "../testing/fake-event-stream.js";
import { emptyMeetingState, type MeetingFoldState } from "../transcript/event-fold.js";
import { IDS, SERVER_NOW, meetingStarted, phaseChanged, turnCommitted, turnDelta } from "../testing/fixtures.js";
import type { VisibilitySource } from "./reconnect-schedule.js";

// A fake document that the test can flip between hidden and visible.
function fakeDocument(): VisibilitySource & { dispatch: (state: string) => void } {
  let listener: (() => void) | null = null;
  const document = {
    visibilityState: "visible",
    addEventListener: (kind: "visibilitychange", next: () => void) => {
      listener = next;
    },
    removeEventListener: () => {
      listener = null;
    },
    dispatch: (state: string) => {
      document.visibilityState = state;
      listener?.();
    },
  };
  return document;
}

// The states the feed reported, in order, with the status of each.
type Reported = { state: MeetingFoldState; status: FeedStatus };

describe("meeting stream client using a fake stream", () => {
  let server: FakeMeetingServer;
  let feed: MeetingFeed | null;
  let records: Reported[];

  // Starts one feed over the given fake server script.
  async function start(streams: FakeStream[], polls: unknown[], visibility: VisibilitySource | null = null): Promise<void> {
    server = fakeMeetingServer(streams, polls);
    records = [];
    const options: MeetingFeedOptions = {
      meetingId: IDS.meeting,
      onState: (state, status) => records.push({ state, status }),
      onStopped: () => undefined,
      fetchImpl: server.fetchImpl,
      random: () => 0,
      visibility,
      origin: "http://app.test",
    };
    feed = openMeetingFeed(options);
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date(SERVER_NOW));
    feed = null;
  });

  afterEach(() => {
    feed?.close();
    vi.useRealTimers();
  });

  it("D50-T1: parseSseText splits frames, joins data lines and treats comment lines as comments", () => {
    const parsed = parseSseText(':hb\n\nid: 3\nevent: turn.committed\ndata: {"seq":3}\n\nevent: turn.d');
    expect(parsed.frames).toEqual([
      { id: null, event: null, data: null },
      { id: "3", event: "turn.committed", data: '{"seq":3}' },
    ]);
    expect(parsed.rest).toBe("event: turn.d");
    const joined = parseSseText("data: a\ndata: b\n\n");
    expect(joined.frames).toEqual([{ id: null, event: null, data: "a\nb" }]);
    expect(joined.rest).toBe("");
  });

  it("D50-T2: the padding and the heartbeat count as the first byte and change no state, using a fake stream and fake timers", async () => {
    await start([{ kind: "frames", chunks: [":" + " ".repeat(2045) + "\n\n", ":hb\n\n"], then: "hang" }], []);
    await vi.advanceTimersByTimeAsync(6000);
    expect(server.pollRequests).toHaveLength(0);
    expect(records.at(-1)?.status).toBe("live");
    expect(feed?.currentState()).toEqual(emptyMeetingState(IDS.meeting));
  });

  it("I18-T1: after seq 1 to 3 and a dropped stream the feed reconnects with Last-Event-ID 3 and the first event applied is 4, using a fake stream and fake timers", async () => {
    const first = sseFrame(meetingStarted(1)) + sseFrame(phaseChanged(2, "open", 1)) + sseFrame(turnCommitted({ seq: 3, stepSeq: 1, side: "a", text: "Hello" }));
    await start([{ kind: "frames", chunks: [first], then: "end" }, { kind: "frames", chunks: [sseFrame(turnCommitted({ seq: 4, stepSeq: 2, side: "b", text: "Hi" }))], then: "hang" }], []);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.streamRequests[0]?.lastEventId).toBeNull();
    expect(server.streamRequests[1]?.lastEventId).toBe("3");
    const seqs = [...new Set(records.map((record) => record.state.lastSeq))];
    expect(seqs).toEqual([0, 1, 2, 3, 4]);
    expect(feed?.currentState().timeline.map((item) => item.seq)).toEqual([2, 3, 4]);
  });

  it("D49-T1: a silent stream switches to polling at 5.0 s and polls every 2.0 s, using a fake silent stream and fake timers", async () => {
    await start([{ kind: "silent" }], [{ v: 1, events: [], partial: null, serverNow: SERVER_NOW }]);
    await vi.advanceTimersByTimeAsync(4999);
    expect(server.pollRequests).toHaveLength(0);
    expect(feed?.currentStatus()).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1);
    expect(server.pollRequests).toHaveLength(1);
    expect(server.pollRequests[0]?.after).toBe("0");
    expect(feed?.currentStatus()).toBe("polling");
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.pollRequests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.pollRequests).toHaveLength(3);
  });

  it("R8.2-T1: the first byte on a later stream stops polling, using a fake silent stream, a fake document and fake timers", async () => {
    const document = fakeDocument();
    await start([{ kind: "silent" }, { kind: "frames", chunks: [sseFrame(meetingStarted(1))], then: "hang" }], [{ v: 1, events: [], partial: null, serverNow: SERVER_NOW }], document);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    document.dispatch("visible");
    await vi.advanceTimersByTimeAsync(4000);
    expect(server.pollRequests).toHaveLength(1);
    expect(server.streamRequests).toHaveLength(2);
    expect(records.at(-1)?.status).toBe("live");
    expect(feed?.currentState().lastSeq).toBe(1);
  });

  it("D52-T1: Last-Event-ID is the last committed seq and never a delta, using a fake stream and fake timers", async () => {
    const chunk = sseFrame(meetingStarted(1)) + sseFrame(turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "Hi" })) + sseFrame(turnDelta({ stepSeq: 2, attempt: 1, side: "b", offset: 0, text: "Hel" }));
    await start([{ kind: "frames", chunks: [chunk], then: "end" }, { kind: "silent" }], []);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.streamRequests[1]?.lastEventId).toBe("2");
    expect(feed?.currentState().partial).toEqual({ stepSeq: 2, attempt: 1, side: "b", text: "Hel" });
  });

  it("R8.3-T1: turning visible reopens the stream at once with Last-Event-ID of the last seq, using a fake document and a fake stream", async () => {
    const document = fakeDocument();
    const chunk = sseFrame(meetingStarted(1)) + sseFrame(phaseChanged(2, "open", 1));
    await start([{ kind: "frames", chunks: [chunk], then: "hang" }, { kind: "silent" }], [], document);
    document.dispatch("hidden");
    await vi.advanceTimersByTimeAsync(0);
    expect(server.streamRequests).toHaveLength(1);
    document.dispatch("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(server.streamRequests).toHaveLength(2);
    expect(server.streamRequests[1]?.lastEventId).toBe("2");
  });

  it("D47-T1: deltas at wrong offsets trigger exactly one resync poll, using a fake stream and fake timers", async () => {
    const chunk = sseFrame(meetingStarted(1)) + sseFrame(turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 0, text: "Hello" })) + sseFrame(turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 12, text: "x" })) + sseFrame(turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 20, text: "y" }));
    await start([{ kind: "frames", chunks: [chunk], then: "hang" }], [{ v: 1, events: [], partial: { stepSeq: 1, attempt: 1, side: "a", text: "Hello there" }, serverNow: SERVER_NOW }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(server.pollRequests).toHaveLength(1);
    expect(server.pollRequests[0]?.after).toBe("1");
    expect(feed?.currentState().partial?.text).toBe("Hello there");
    expect(feed?.currentState().resyncRequested).toBe(false);
  });

  it("R8.4-T1: a 401 on the stream stops the feed without reconnecting, using a fake stream and fake timers", async () => {
    const onStopped = vi.fn();
    server = fakeMeetingServer([{ kind: "status", status: 401, body: { code: "session_missing", message: "Sign in again from the start page." } }], []);
    feed = openMeetingFeed({ meetingId: IDS.meeting, onState: () => undefined, onStopped, fetchImpl: server.fetchImpl, random: () => 0, visibility: null, origin: "http://app.test" });
    await vi.advanceTimersByTimeAsync(60000);
    expect(onStopped).toHaveBeenCalledTimes(1);
    const error = onStopped.mock.calls[0]?.[0] as { code: string };
    expect(error.code).toBe("session_missing");
    expect(server.streamRequests).toHaveLength(1);
    expect(server.pollRequests).toHaveLength(0);
    expect(feed.currentStatus()).toBe("closed");
  });
});
