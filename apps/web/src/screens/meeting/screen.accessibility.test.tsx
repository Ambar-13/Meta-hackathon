import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import type { CommittedEvent } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { fakeMeetingFeed } from "../../testing/fake-event-stream.js";
import {
  claimFixture,
  IDS,
  meetingStarted,
  meetingView,
  SERVER_NOW,
  turnCommitted,
} from "../../testing/fixtures.js";
import {
  foldEvent,
  foldRaw,
  emptyMeetingState,
  type MeetingFoldState,
} from "../../transcript/event-fold.js";
import type { FeedStatus } from "../../streaming/sse-client.js";
import { MeetingScreen } from "./screen.js";

const RUNNING = meetingView({
  state: "running",
  startedAt: SERVER_NOW,
  endsAt: "2026-10-27T10:10:00.000Z",
});

// Folds the events in order from an empty meeting.
function fold(...events: CommittedEvent[]): MeetingFoldState {
  return events.reduce((state, event) => foldEvent(state, event), emptyMeetingState(IDS.meeting));
}

// Renders the meeting page with a fake feed and the running view.
function renderMeeting(feed: ReturnType<typeof fakeMeetingFeed>, view = RUNNING): void {
  stubRoute(routes.meetings.readMeeting, view);
  renderScreen(<MeetingScreen openFeed={feed.openFeed} />, {
    pattern: ROUTE_PATTERNS.meeting,
    url: APP_PATHS.meeting(IDS.meeting),
  });
}

// Pushes one state and status from the fake feed inside act.
function push(
  feed: ReturnType<typeof fakeMeetingFeed>,
  state: MeetingFoldState,
  status: FeedStatus = "live",
): void {
  act(() => {
    feed.push(state, status);
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("meeting screen", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("R5.11-T4: a state that needs a refresh shows the refresh line and keeps the transcript", async () => {
    const feed = fakeMeetingFeed();
    renderMeeting(feed);
    await vi.waitFor(() => {
      expect(feed.openCount()).toBe(1);
    });
    const base = fold(
      meetingStarted(1),
      turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "Hello there" }),
    );
    push(
      feed,
      foldRaw(base, { ...turnCommitted({ seq: 3, stepSeq: 2, side: "b", text: "Yo" }), v: 2 }),
    );
    expect(await screen.findByText("refresh for the new version")).toBeTruthy();
    expect(screen.getByText("Hello there")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("R6.5-T3: a flagged claim shows no receipt under its turn", async () => {
    const feed = fakeMeetingFeed();
    renderMeeting(feed);
    await vi.waitFor(() => {
      expect(feed.openCount()).toBe(1);
    });
    push(
      feed,
      fold(
        meetingStarted(1),
        turnCommitted({
          seq: 2,
          stepSeq: 1,
          side: "a",
          text: "I prefer mornings",
          claims: [claimFixture(false)],
        }),
      ),
    );
    const turn = await screen.findByRole("article");
    // The design pass shows each quote as a quote card, so the turn holds the quote's words, not a
    // "Quote:" prefix.
    expect(turn.textContent).toContain("I work best before nine in the morning");
    expect(turn.textContent).toContain("no quote");
  });

  it("R10.3-T2: Still thinking shows after 20 s with nothing new, using fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const feed = fakeMeetingFeed();
    renderMeeting(feed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    push(feed, fold(meetingStarted(1)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19000);
    });
    expect(screen.queryByText("Still thinking.")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("Still thinking.")).toBeTruthy();
  });

  it("D49-T5: the status line shows polling and reconnecting", async () => {
    const feed = fakeMeetingFeed();
    renderMeeting(feed);
    await vi.waitFor(() => {
      expect(feed.openCount()).toBe(1);
    });
    push(feed, fold(meetingStarted(1)), "polling");
    expect(
      await screen.findByText("Slow connection, so this updates every few seconds."),
    ).toBeTruthy();
    push(feed, fold(meetingStarted(1)), "reconnecting");
    expect(await screen.findByText("Connection lost. Reconnecting.")).toBeTruthy();
    expect(screen.queryByText(/Slow connection/)).toBeNull();
  });

  it("R8.3-T3: the transcript follows new lines only when the reader was within 80 px of the bottom", async () => {
    const feed = fakeMeetingFeed();
    renderMeeting(feed);
    await vi.waitFor(() => {
      expect(feed.openCount()).toBe(1);
    });
    push(feed, fold(meetingStarted(1)));
    const transcript = document.querySelector(".transcript");
    if (!(transcript instanceof HTMLElement)) throw new Error("no transcript element");
    Object.defineProperty(transcript, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(transcript, "clientHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    act(() => {
      transcript.dispatchEvent(new Event("scroll"));
    });
    push(
      feed,
      fold(meetingStarted(1), turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "One" })),
    );
    expect(transcript.scrollTop).toBe(0);
    transcript.scrollTop = 560;
    act(() => {
      transcript.dispatchEvent(new Event("scroll"));
    });
    push(
      feed,
      fold(
        meetingStarted(1),
        turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "One" }),
        turnCommitted({ seq: 3, stepSeq: 2, side: "b", text: "Two" }),
      ),
    );
    expect(transcript.scrollTop).toBe(1000);
  });

  it("R8.6-T2: the meeting page waits without a stream while the meeting is ready and opens one feed once it runs, using fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const feed = fakeMeetingFeed();
    stubRoute(routes.meetings.readMeeting, [meetingView({}), RUNNING]);
    renderScreen(<MeetingScreen openFeed={feed.openFeed} />, {
      pattern: ROUTE_PATTERNS.meeting,
      url: APP_PATHS.meeting(IDS.meeting),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Waiting for the meeting to start.")).toBeTruthy();
    expect(feed.openCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(feed.openCount()).toBe(1);
  });

  it("A8-T8: every control on the meeting page has an accessible name at 375 px", async () => {
    const feed = fakeMeetingFeed();
    renderMeeting(feed);
    await vi.waitFor(() => {
      expect(feed.openCount()).toBe(1);
    });
    push(
      feed,
      fold(meetingStarted(1), turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "Hello" })),
    );
    await screen.findByText("Hello");
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
