import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPoller, pollEventsOnce } from "./poll-fallback.js";
import { fakeMeetingServer } from "../testing/fake-event-stream.js";
import { IDS, SERVER_NOW, turnCommitted } from "../testing/fixtures.js";

describe("poll fallback using a fake fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("D49-T2: pollEventsOnce asks for the events after a seq and returns the lenient reply, using a fake fetch", async () => {
    const reply = {
      v: 1,
      events: [turnCommitted({ seq: 8, stepSeq: 4, side: "b", text: "Hi" })],
      partial: null,
      serverNow: SERVER_NOW,
    };
    const server = fakeMeetingServer([], [reply]);
    const result = await pollEventsOnce({
      meetingId: IDS.meeting,
      afterSeq: 7,
      fetchImpl: server.fetchImpl,
      origin: "http://app.test",
    });
    expect(server.pollRequests[0]?.url).toBe(
      `http://app.test/api/meetings/${IDS.meeting}/events?after=7`,
    );
    expect(result.events).toHaveLength(1);
    expect(result.partial).toBeNull();
    expect(result.v).toBe(1);
  });

  it("D49-T3: a reply holding an unknown event type still returns every event, using a fake fetch", async () => {
    const future = { v: 1, type: "future.event", meetingId: IDS.meeting, at: SERVER_NOW, seq: 8 };
    const reply = {
      v: 1,
      events: [future, turnCommitted({ seq: 9, stepSeq: 4, side: "b", text: "Hi" })],
      partial: null,
      serverNow: SERVER_NOW,
    };
    const server = fakeMeetingServer([], [reply]);
    const result = await pollEventsOnce({
      meetingId: IDS.meeting,
      afterSeq: 7,
      fetchImpl: server.fetchImpl,
      origin: "http://app.test",
    });
    expect(result.events).toHaveLength(2);
  });

  it("D49-T4: createPoller polls at start and every interval and never overlaps itself, using fake timers and a fake poll that takes 3 s", async () => {
    const poll = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 3000)));
    const poller = createPoller({ poll, intervalMs: 2000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(2);
    void poller.runOnce();
    expect(poll).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poller.isRunning()).toBe(false);
  });
});
