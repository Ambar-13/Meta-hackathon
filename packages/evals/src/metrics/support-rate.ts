// Support rate: the mean support rate over briefs the judge could judge reliably. The unreliable count is shown beside it.
import type { EvalRows } from "../collect-rows.js";
import type { MetricResult } from "./index.js";

// Reads the brief support rows and returns the mean over reliable briefs, with the count of unreliable ones in detail.
export function measureSupportRate(rows: EvalRows): MetricResult {
  const reliable = rows.briefMeta.filter(
    (brief) => brief.supportReliable === true && brief.supportRate !== null,
  );
  const unreliable = rows.briefMeta.filter((brief) => brief.supportReliable !== true).length;
  const sum = reliable.reduce((total, brief) => total + (brief.supportRate ?? 0), 0);
  const value = reliable.length === 0 ? null : sum / reliable.length;
  return {
    key: "support_rate",
    label: "support rate",
    value,
    display: value === null ? "no data" : `${value.toFixed(2)} (unreliable ${String(unreliable)})`,
    n: reliable.length,
    target: null,
    direction: null,
    rows: ["A1"],
    detail: { unreliable },
  };
}
