// Cost per complete pair: for each completed meeting, the sum of its ledger rows plus the card rows of its two members, averaged.
import type { EvalRows, LedgerRow } from "../collect-rows.js";
import type { MetricResult } from "./index.js";
import { isCompleted } from "./completion-rate.js";

// The dollars of one ledger row, zero when the row has none. A row without dollars is counted in the returned flag.
function dollarsOf(row: LedgerRow): { usd: number; isMissing: boolean } {
  return row.usd === null ? { usd: 0, isMissing: true } : { usd: row.usd, isMissing: false };
}

// The cost of one completed meeting: its own ledger rows and the card rows of the two people in it.
function costOf(meetingId: string, rows: EvalRows): { usd: number; missing: number } {
  const sides = rows.personBySide.get(meetingId);
  const members = sides === undefined ? [] : [sides.a, sides.b];
  const relevant = rows.ledger.filter((row) => row.meetingId === meetingId || (row.callSite === "card" && row.personId !== null && members.includes(row.personId)));
  const priced = relevant.map(dollarsOf);
  return { usd: priced.reduce((total, item) => total + item.usd, 0), missing: priced.filter((item) => item.isMissing).length };
}

// Reads the completed meetings and returns the mean cost per completed meeting, with the rows that had no dollars counted in detail.
export function measureCostPerPair(rows: EvalRows): MetricResult {
  const completed = rows.meetings.filter((meeting) => meeting.startedAt !== null && isCompleted(meeting));
  const costs = completed.map((meeting) => costOf(meeting.meetingId, rows));
  const total = costs.reduce((sum, item) => sum + item.usd, 0);
  const value = costs.length === 0 ? null : total / costs.length;
  return {
    key: "cost_per_complete_pair_usd",
    label: "cost per complete pair",
    value,
    display: value === null ? "no data" : `${value.toFixed(4)} USD`,
    n: costs.length,
    target: null,
    direction: null,
    rows: ["D60"],
    detail: { rowsWithoutUsd: costs.reduce((sum, item) => sum + item.missing, 0) },
  };
}
