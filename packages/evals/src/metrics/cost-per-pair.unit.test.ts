// Unit tests for cost per complete pair: the meeting's ledger plus both members' card rows, over completed meetings only.
import { describe, expect, it } from "vitest";
import type { EvalRows, LedgerRow, MeetingRow } from "../collect-rows.js";
import { measureCostPerPair } from "./cost-per-pair.js";

// A rows object with the meetings, ledger and sides the test sets.
function rowsWith(partial: Pick<EvalRows, "meetings" | "ledger">): EvalRows {
  return {
    claims: [], briefLines: [], turns: new Map(), briefMeta: [], events: [],
    questionByMeeting: new Map(), plantedMarkers: [],
    personBySide: new Map([["m1", { a: "pa", b: "pb" }], ["m2", { a: "pc", b: "pd" }]]),
    ...partial,
  };
}

// A meeting row with the fields the metric reads.
function meeting(meetingId: string, endReason: string, briefCount: number): MeetingRow {
  return { meetingId, state: "ended", endReason, startedAt: new Date("2026-10-27T10:00:00Z"), firstTokenAt: null, briefCount };
}

// A ledger row for a meeting call, or for a person's card build (meetingId null).
function ledgerRow(input: { meetingId: string | null; personId: string | null; callSite: string; usd: number | null }): LedgerRow {
  return { meetingId: input.meetingId, personId: input.personId, callSite: input.callSite, usd: input.usd, model: "muse-spark-1.3" };
}

describe("cost per complete pair", () => {
  it("W2-EVAL-T7 (D60): cost per complete pair sums the meeting's ledger and both members' card rows, over completed meetings only", () => {
    const rows = rowsWith({
      meetings: [meeting("m1", "decided", 2), meeting("m2", "budget", 1)],
      ledger: [
        ledgerRow({ meetingId: "m1", personId: null, callSite: "speech", usd: 0.3 }),
        ledgerRow({ meetingId: null, personId: "pa", callSite: "card", usd: 0.1 }),
        ledgerRow({ meetingId: null, personId: "pb", callSite: "card", usd: 0.05 }),
        ledgerRow({ meetingId: "m2", personId: null, callSite: "speech", usd: 9.99 }),
      ],
    });
    const result = measureCostPerPair(rows);
    expect(result.value).toBeCloseTo(0.45, 10);
    expect(result.n).toBe(1);
    expect(result.display).toBe("0.4500 USD");
    expect(result.detail.rowsWithoutUsd).toBe(0);
  });

  it("W2-EVAL-T7b (D60): a null usd counts as 0 and is counted in rowsWithoutUsd", () => {
    const rows = rowsWith({
      meetings: [meeting("m1", "decided", 2)],
      ledger: [
        ledgerRow({ meetingId: "m1", personId: null, callSite: "speech", usd: 0.3 }),
        ledgerRow({ meetingId: null, personId: "pa", callSite: "card", usd: 0.1 }),
        ledgerRow({ meetingId: null, personId: "pb", callSite: "card", usd: 0.05 }),
        ledgerRow({ meetingId: "m1", personId: null, callSite: "receipts", usd: null }),
      ],
    });
    const result = measureCostPerPair(rows);
    expect(result.value).toBeCloseTo(0.45, 10);
    expect(result.detail.rowsWithoutUsd).toBe(1);
  });
});
