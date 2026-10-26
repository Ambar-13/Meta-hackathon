// Unit tests for the support rate: the mean over reliable briefs only, with the unreliable count beside it.
import { describe, expect, it } from "vitest";
import type { EvalRows } from "../collect-rows.js";
import { measureSupportRate } from "./support-rate.js";

// A rows object with every list empty except the one the test sets.
function rowsWith(partial: Partial<EvalRows>): EvalRows {
  return {
    claims: [], briefLines: [], turns: new Map(), events: [], meetings: [], ledger: [],
    questionByMeeting: new Map(), personBySide: new Map(), plantedMarkers: [], briefMeta: [],
    ...partial,
  };
}

describe("support rate", () => {
  it("W2-EVAL-T3 (A1): support rate averages reliable briefs only and reports the unreliable count", () => {
    const briefMeta = [
      { meetingId: "m1", personId: "pa", supportRate: 0.8, supportReliable: true },
      { meetingId: "m1", personId: "pb", supportRate: 0.9, supportReliable: true },
      { meetingId: "m2", personId: "pa", supportRate: null, supportReliable: null },
      { meetingId: "m2", personId: "pb", supportRate: 0.4, supportReliable: false },
    ];
    const result = measureSupportRate(rowsWith({ briefMeta }));
    expect(result.value).toBeCloseTo(0.85, 10);
    expect(result.n).toBe(2);
    expect(result.detail.unreliable).toBe(2);
    expect(result.display).toBe("0.85 (unreliable 2)");
  });
});
