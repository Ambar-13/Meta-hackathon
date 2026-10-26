// Evidence validity: the share of committed claims whose quote the check accepted. Flagged claims stay in the count (A2, R6.4).
import type { EvalRows } from "../collect-rows.js";
import type { MetricResult } from "./index.js";

// Reads the claims rows of the driven meetings and returns the valid share, or no value when there are no claims.
export function measureEvidenceValidity(rows: EvalRows): MetricResult {
  const total = rows.claims.length;
  const valid = rows.claims.filter((claim) => claim.evidenceValid).length;
  const value = total === 0 ? null : valid / total;
  return {
    key: "evidence_validity",
    label: "evidence validity",
    value,
    display: value === null ? "no data" : value.toFixed(3),
    n: total,
    target: null,
    direction: null,
    rows: ["A2", "R6.4"],
    detail: {},
  };
}
