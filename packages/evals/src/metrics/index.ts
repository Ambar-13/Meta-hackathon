// The seven metrics in their table order, the result shape they share, and the targets they are
// judged against.
import { z } from "zod";
import type { EvalRows } from "../collect-rows.js";
import { measureCostPerPair } from "./cost-per-pair.js";
import { measureCompletionRate } from "./completion-rate.js";
import { measureEvidenceValidity } from "./evidence-validity.js";
import { measureFirstTurnLatency } from "./first-turn-latency.js";
import { measureGroundedBriefRate } from "./grounded-brief-rate.js";
import { measureInjectionLeakage } from "./injection-leakage.js";
import { measureSupportRate } from "./support-rate.js";

// The nearest-rank percentile, exported from this folder for the tests and the table.
export { percentile } from "./first-turn-latency.js";

// The seven metric keys, the names the results file uses.
export type MetricKey =
  | "evidence_validity"
  | "grounded_brief_rate"
  | "support_rate"
  | "injection_leakage"
  | "completion_rate"
  | "first_turn_latency_ms"
  | "cost_per_complete_pair_usd";
// One metric as the run reports it: its value, the text shown, the sample size and its target.
export type MetricResult = {
  key: MetricKey;
  label: string;
  value: number | null;
  display: string;
  n: number;
  target: number | null;
  direction: "at_least" | "at_most" | null;
  rows: string[];
  detail: Record<string, number | string | null>;
};
// The target of each metric; null means the metric is printed without a threshold.
export type Targets = Record<MetricKey, number | null>;

// The metrics in the order the table prints them.
const METRICS: ReadonlyArray<(rows: EvalRows) => MetricResult> = [
  measureEvidenceValidity,
  measureGroundedBriefRate,
  measureSupportRate,
  measureInjectionLeakage,
  measureCompletionRate,
  measureFirstTurnLatency,
  measureCostPerPair,
];
// Whether a metric must be at least its target or at most it. Only two metrics have a threshold.
const DIRECTIONS: Record<MetricKey, "at_least" | "at_most" | null> = {
  evidence_validity: null,
  grounded_brief_rate: "at_least",
  support_rate: null,
  injection_leakage: "at_most",
  completion_rate: null,
  first_turn_latency_ms: null,
  cost_per_complete_pair_usd: null,
};
// The shape of targets.json: every metric key, each a number or null.
const TargetsFile = z
  .object({
    evidence_validity: z.number().nullable(),
    grounded_brief_rate: z.number().nullable(),
    support_rate: z.number().nullable(),
    injection_leakage: z.number().nullable(),
    completion_rate: z.number().nullable(),
    first_turn_latency_ms: z.number().nullable(),
    cost_per_complete_pair_usd: z.number().nullable(),
  })
  .strict();

// Reads the targets file's text and returns the targets; a file with a missing or extra key is
// refused with zod's message.
export function parseTargets(json: unknown): Targets {
  return TargetsFile.parse(json);
}

// Runs the seven metrics over the rows in table order and attaches each target and direction from
// the targets file.
export function computeAllMetrics(rows: EvalRows, targets: Targets): MetricResult[] {
  return METRICS.map((measure) => {
    const result = measure(rows);
    return { ...result, target: targets[result.key], direction: DIRECTIONS[result.key] };
  });
}
