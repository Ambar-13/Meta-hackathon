// First-turn latency: the time from a meeting's start to its first model token, as nearest-rank
// percentiles in milliseconds.
import type { EvalRows } from "../collect-rows.js";
import type { MetricResult } from "./index.js";

// The nearest-rank percentile: sort ascending and take the value at index ceil(p * n) - 1. Empty
// input gives null.
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? null;
}

// Groups the thousands of a whole number with commas, for the display text.
function withCommas(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Reads the meetings with both times and returns the p50 in detail as the value and the p90 in
// detail.
export function measureFirstTurnLatency(rows: EvalRows): MetricResult {
  const latencies = rows.meetings.flatMap((meeting) => {
    if (meeting.startedAt === null || meeting.firstTokenAt === null) return [];
    return [meeting.firstTokenAt.getTime() - meeting.startedAt.getTime()];
  });
  const p50 = percentile(latencies, 0.5);
  const p90 = percentile(latencies, 0.9);
  return {
    key: "first_turn_latency_ms",
    label: "first-turn latency",
    value: p50,
    display:
      p50 === null || p90 === null
        ? "no data"
        : `p50 ${withCommas(p50)} ms / p90 ${withCommas(p90)} ms`,
    n: latencies.length,
    target: null,
    direction: null,
    rows: ["R10.3"],
    detail: { p90 },
  };
}
