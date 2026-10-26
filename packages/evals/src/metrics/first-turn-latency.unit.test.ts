// Unit tests for first-turn latency: nearest-rank percentiles over the meetings that have both times.
import { describe, expect, it } from "vitest";
import type { EvalRows, MeetingRow } from "../collect-rows.js";
import { measureFirstTurnLatency, percentile } from "./first-turn-latency.js";

// A rows object with every list empty except the meetings the test sets.
function rowsWith(meetings: MeetingRow[]): EvalRows {
  return {
    claims: [], briefLines: [], turns: new Map(), briefMeta: [], events: [], ledger: [],
    questionByMeeting: new Map(), personBySide: new Map(), plantedMarkers: [], meetings,
  };
}

// A meeting that started at a fixed time and got its first token after latencyMs.
function meetingWithLatency(meetingId: string, latencyMs: number): MeetingRow {
  const startedAt = new Date("2026-10-27T10:00:00Z");
  return { meetingId, state: "ended", endReason: "decided", startedAt, firstTokenAt: new Date(startedAt.getTime() + latencyMs), briefCount: 2 };
}

describe("first-turn latency", () => {
  it("W2-EVAL-T6 (R10.3): first-turn latency is nearest-rank p50 and p90 in ms", () => {
    const rows = rowsWith([1000, 2000, 3000, 4000, 10000].map((ms, index) => meetingWithLatency(`m${String(index)}`, ms)));
    const result = measureFirstTurnLatency(rows);
    expect(result.value).toBe(3000);
    expect(result.detail.p90).toBe(10000);
    expect(result.n).toBe(5);
    expect(result.display).toBe("p50 3,000 ms / p90 10,000 ms");
  });

  it("W2-EVAL-T6b (R10.3): percentile of no values is null", () => {
    expect(percentile([], 0.5)).toBeNull();
  });
});
