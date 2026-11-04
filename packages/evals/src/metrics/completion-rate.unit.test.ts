// Unit tests for completion: a meeting counts as complete when it ended decided with both briefs.
import { describe, expect, it } from "vitest";
import type { EvalRows, MeetingRow } from "../collect-rows.js";
import { measureCompletionRate } from "./completion-rate.js";

// A rows object with every list empty except the meetings the test sets.
function rowsWith(meetings: MeetingRow[]): EvalRows {
  return {
    claims: [],
    briefLines: [],
    turns: new Map(),
    briefMeta: [],
    events: [],
    ledger: [],
    questionByMeeting: new Map(),
    personBySide: new Map(),
    plantedMarkers: [],
    meetings,
  };
}

// A meeting row with the fields the metric reads.
function meeting(input: {
  meetingId: string;
  state: string;
  endReason: string | null;
  briefCount: number;
  startedAt: Date | null;
}): MeetingRow {
  return {
    meetingId: input.meetingId,
    state: input.state,
    endReason: input.endReason,
    startedAt: input.startedAt,
    firstTokenAt: null,
    briefCount: input.briefCount,
  };
}

describe("completion rate", () => {
  it("W2-EVAL-T5 (A2): completion needs ended, decided and two briefs, over meetings started", () => {
    const started = new Date("2026-10-27T10:00:00Z");
    const rows = rowsWith([
      meeting({
        meetingId: "m1",
        state: "ended",
        endReason: "decided",
        briefCount: 2,
        startedAt: started,
      }),
      meeting({
        meetingId: "m2",
        state: "ended",
        endReason: "decided",
        briefCount: 1,
        startedAt: started,
      }),
      meeting({
        meetingId: "m3",
        state: "ended",
        endReason: "budget",
        briefCount: 2,
        startedAt: started,
      }),
      meeting({
        meetingId: "m4",
        state: "running",
        endReason: null,
        briefCount: 0,
        startedAt: started,
      }),
      meeting({ meetingId: "m5", state: "ready", endReason: null, briefCount: 0, startedAt: null }),
    ]);
    const result = measureCompletionRate(rows);
    expect(result.value).toBeCloseTo(0.25, 10);
    expect(result.n).toBe(4);
    expect(result.display).toBe("0.250");
  });
});
