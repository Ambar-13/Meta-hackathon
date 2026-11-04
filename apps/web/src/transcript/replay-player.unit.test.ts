import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CommittedEvent,
  ContractError,
  type CommittedEvent as Committed,
} from "@meet-first/contracts";
import { playReplay, replayTimeline } from "./replay-player.js";
import { emptyMeetingState, foldEvent } from "./event-fold.js";
import {
  IDS,
  meetingStarted,
  phaseChanged,
  replayExport,
  turnCommitted,
} from "../testing/fixtures.js";

// One event with its time set, parsed with the contracts schema.
function at(event: Committed, iso: string): Committed {
  return CommittedEvent.parse({ ...event, at: iso });
}

describe("replay player", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("R8.8-T1: replayTimeline divides the gaps by the speed", () => {
    const events = [
      at(meetingStarted(1), "2026-10-27T10:00:00.000Z"),
      at(phaseChanged(2, "open", 1), "2026-10-27T10:00:04.000Z"),
      at(turnCommitted({ seq: 3, stepSeq: 1, side: "a", text: "Hi" }), "2026-10-27T10:00:10.000Z"),
    ];
    expect(replayTimeline(replayExport(events), 2).map((step) => step.atMs)).toEqual([
      0, 2000, 5000,
    ]);
  });

  it("R8.8-T3: playReplay feeds every event to the same fold in seq order, using fake timers", () => {
    const events = [
      at(phaseChanged(2, "open", 1), "2026-10-27T10:00:01.000Z"),
      at(meetingStarted(1), "2026-10-27T10:00:00.000Z"),
    ];
    const onState = vi.fn();
    playReplay(replayExport(events), { speed: 1, onState });
    vi.advanceTimersByTime(1000);
    expect(onState).toHaveBeenCalledTimes(2);
    const sorted = [events[1], events[0]].filter(
      (event): event is Committed => event !== undefined,
    );
    const expected = sorted.reduce(
      (state, event) => foldEvent(state, event),
      emptyMeetingState(IDS.meeting),
    );
    expect(onState.mock.calls.at(-1)?.[0]).toEqual(expected);
  });

  it("R8.8-T4: a speed of 0 or NaN throws replay_speed_invalid", () => {
    expect(() => replayTimeline(replayExport([]), 0)).toThrow(ContractError);
    expect(() => replayTimeline(replayExport([]), Number.NaN)).toThrow(ContractError);
    try {
      replayTimeline(replayExport([]), 0);
    } catch (error: unknown) {
      expect((error as ContractError).code).toBe("replay_speed_invalid");
    }
  });
});
