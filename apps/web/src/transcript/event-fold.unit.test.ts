import { describe, expect, it } from "vitest";
import type { CommittedEvent } from "@meet-first/contracts";
import {
  emptyMeetingState,
  foldEvent,
  foldPollReply,
  foldRaw,
  isThinking,
  refreshNotice,
  claimNeedsMark,
  type MeetingFoldState,
} from "./event-fold.js";
import {
  claimFixture,
  IDS,
  meetingEnded,
  meetingStarted,
  phaseChanged,
  recallCalled,
  SERVER_NOW,
  turnCommitted,
  turnDelta,
} from "../testing/fixtures.js";

// Folds the events in order, starting from an empty meeting.
function fold(...events: CommittedEvent[]): MeetingFoldState {
  return events.reduce((state, event) => foldEvent(state, event), emptyMeetingState(IDS.meeting));
}

describe("event fold", () => {
  it("R5.11-T1: the fold ignores an unknown event type and returns the same state", () => {
    const state = fold(meetingStarted(1));
    const next = foldRaw(state, {
      v: 1,
      type: "future.event",
      meetingId: IDS.meeting,
      at: SERVER_NOW,
      seq: 2,
    });
    expect(next).toBe(state);
  });

  it("R5.11-T2: a v 2 event sets needsRefresh, keeps the timeline, and refreshNotice gives the refresh copy", () => {
    const state = fold(
      meetingStarted(1),
      turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "Hi" }),
    );
    const next = foldRaw(state, {
      ...turnCommitted({ seq: 3, stepSeq: 2, side: "b", text: "Yo" }),
      v: 2,
    });
    expect(next.needsRefresh).toBe(true);
    expect(next.timeline).toEqual(state.timeline);
    expect(next.lastSeq).toBe(2);
    expect(refreshNotice(next)).toBe("refresh for the new version");
    expect(refreshNotice(state)).toBeNull();
  });

  it("R5.11-T3: a poll reply with v 2 sets needsRefresh and applies nothing", () => {
    const reply = {
      v: 2,
      events: [turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "Hi" })],
      partial: null,
      serverNow: SERVER_NOW,
    };
    const next = foldPollReply(fold(meetingStarted(1)), reply);
    expect(next.needsRefresh).toBe(true);
    expect(next.lastSeq).toBe(1);
    expect(next.timeline).toEqual([]);
  });

  it("R8.1-T1: a repeated seq is applied once", () => {
    const state = fold(meetingStarted(1), phaseChanged(2, "open", 1), phaseChanged(2, "open", 1));
    expect(state.timeline).toHaveLength(1);
    expect(state.lastSeq).toBe(2);
  });

  it("R8.1-T2: a gap asks for a resync and the poll reply fills it in seq order", () => {
    const gapped = foldEvent(
      fold(meetingStarted(1)),
      turnCommitted({ seq: 3, stepSeq: 1, side: "a", text: "Hi" }),
    );
    const filled = foldPollReply(gapped, {
      v: 1,
      events: [
        turnCommitted({ seq: 3, stepSeq: 1, side: "a", text: "Hi" }),
        phaseChanged(2, "open", 1),
      ],
      partial: null,
      serverNow: SERVER_NOW,
    });
    expect(gapped.resyncRequested).toBe(true);
    expect(gapped.lastSeq).toBe(1);
    expect(filled.lastSeq).toBe(3);
    expect(filled.timeline.map((item) => item.seq)).toEqual([2, 3]);
    expect(filled.resyncRequested).toBe(false);
  });

  it("R5.7-T1: turn.committed replaces the partial with the committed text", () => {
    const state = foldEvent(
      fold(meetingStarted(1)),
      turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 0, text: "Hel" }),
    );
    const next = foldEvent(
      state,
      turnCommitted({ seq: 2, stepSeq: 1, side: "a", text: "Hello world" }),
    );
    expect(next.partial).toBeNull();
    const last = next.timeline.at(-1);
    expect(last?.kind === "turn" ? last.text : null).toBe("Hello world");
    expect(next.lastCommittedStepSeq).toBe(1);
  });

  it("R7.1-T1: a recall call shows as a line for its side with its query", () => {
    const state = fold(meetingStarted(1), recallCalled(2, "a", "mornings"));
    expect(state.timeline.at(-1)).toEqual({ kind: "recall", seq: 2, side: "a", query: "mornings" });
  });

  it("R6.5-T1: claimNeedsMark is true for an unverified claim only", () => {
    expect(claimNeedsMark(claimFixture(false))).toBe(true);
    expect(claimNeedsMark(claimFixture(true))).toBe(false);
  });

  it("R10.3-T1: the meeting counts as thinking after 20 s of silence", () => {
    const running = fold(meetingStarted(1));
    expect(isThinking(running, 0, 19_999)).toBe(false);
    expect(isThinking(running, 0, 20_000)).toBe(true);
    expect(isThinking(fold(meetingStarted(1), meetingEnded(2)), 0, 20_000)).toBe(false);
    expect(isThinking(emptyMeetingState(IDS.meeting), 0, 20_000)).toBe(false);
  });
});
