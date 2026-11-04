// Unit tests for the evidence validity metric: fixture tables written out as literal rows.
import { describe, expect, it } from "vitest";
import type { EvalRows } from "../collect-rows.js";
import { measureEvidenceValidity } from "./evidence-validity.js";

// A rows object with every list empty, so each test sets only what it reads.
function rowsWith(partial: Partial<EvalRows>): EvalRows {
  return {
    claims: [],
    briefLines: [],
    turns: new Map(),
    briefMeta: [],
    events: [],
    meetings: [],
    ledger: [],
    questionByMeeting: new Map(),
    personBySide: new Map(),
    plantedMarkers: [],
    ...partial,
  };
}

// One claim row with the flags the metric reads.
function claim(evidenceValid: boolean, flagged: boolean) {
  return {
    meetingId: "m1",
    side: "a" as const,
    verified: evidenceValid,
    flagged,
    evidenceValid,
    text: "A claim.",
  };
}

describe("evidence validity", () => {
  it("W2-EVAL-T1 (A2, R6.4): evidence validity is valid claims over all committed claims, flagged ones included", () => {
    const claims = [
      claim(true, false),
      claim(true, false),
      claim(true, false),
      claim(true, false),
      claim(true, false),
      claim(true, false),
      claim(true, false),
      claim(false, true),
      claim(false, true),
      claim(false, false),
    ];
    const result = measureEvidenceValidity(rowsWith({ claims }));
    expect(result.value).toBeCloseTo(0.7, 10);
    expect(result.display).toBe("0.700");
    expect(result.n).toBe(10);
  });

  it("W2-EVAL-T1b: no claims gives no value and n 0", () => {
    const result = measureEvidenceValidity(rowsWith({}));
    expect(result.value).toBeNull();
    expect(result.n).toBe(0);
  });
});
