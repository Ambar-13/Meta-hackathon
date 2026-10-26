// Completion: meetings that ended decided with both briefs, over meetings that started (A2).
import type { EvalRows, MeetingRow } from "../collect-rows.js";
import type { MetricResult } from "./index.js";

// Whether one meeting counts as complete: it ended decided and both briefs were written.
export function isCompleted(meeting: MeetingRow): boolean {
  return meeting.state === "ended" && meeting.endReason === "decided" && meeting.briefCount === 2;
}

// Reads the meeting rows of the driven pairs and returns the completed share of the meetings that started.
export function measureCompletionRate(rows: EvalRows): MetricResult {
  const started = rows.meetings.filter((meeting) => meeting.startedAt !== null);
  const completed = started.filter(isCompleted).length;
  const value = started.length === 0 ? null : completed / started.length;
  return {
    key: "completion_rate",
    label: "end-to-end completion by fresh pairs",
    value,
    display: value === null ? "no data" : value.toFixed(3),
    n: started.length,
    target: null,
    direction: null,
    rows: ["A2"],
    detail: {},
  };
}
