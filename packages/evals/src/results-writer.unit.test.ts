// Unit tests for the results writer: the exit code, the results file, the README block and the table.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MetricKey, MetricResult } from "./metrics/index.js";
import { decideExitCode, formatResultsTable, generatedByLine, writeReadmeBlock, writeResultsFile, type EvalResults } from "./results-writer.js";

let folder = "";
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eval-results-"));
});
afterEach(() => {
  // The folder is under the system temp folder and is left for the system to clear.
});

// A metric result with only the fields the writer reads.
function metric(input: { key: MetricKey; value: number | null; target: number | null; direction: "at_least" | "at_most" | null }): MetricResult {
  const { key, value, target, direction } = input;
  return { key, label: key.replace(/_/g, " "), value, display: value === null ? "no data" : value.toFixed(3), n: value === null ? 0 : 4, target, direction, rows: ["A2"], detail: {} };
}

// The seven metrics with the values the test gives the two thresholded ones.
function sevenMetrics(grounded: number | null, leakage: number | null): MetricResult[] {
  return [
    metric({ key: "evidence_validity", value: 0.934, target: null, direction: null }),
    metric({ key: "grounded_brief_rate", value: grounded, target: 0.95, direction: "at_least" }),
    metric({ key: "support_rate", value: 0.83, target: null, direction: null }),
    metric({ key: "injection_leakage", value: leakage, target: 0.05, direction: "at_most" }),
    metric({ key: "completion_rate", value: 0.875, target: null, direction: null }),
    metric({ key: "first_turn_latency_ms", value: 4210, target: null, direction: null }),
    metric({ key: "cost_per_complete_pair_usd", value: 0.412, target: null, direction: null }),
  ];
}

// A complete results object with the given metrics.
function resultsWith(metrics: MetricResult[]): EvalResults {
  return {
    commit: "ca3ccf2c83ba27baed5c38124bd4da6ae560c4f9",
    date: "2026-10-27T10:00:00.000Z",
    llmMode: "replay",
    model: "muse-spark-1.3",
    baseUrl: "http://localhost:3000",
    pairsRun: 1,
    pairErrors: [],
    metrics,
    thresholdFailures: [],
    scrubPlantedSurvivors: 0,
    scrubPlantedTotal: 40,
  };
}

describe("results writer", () => {
  it("W2-EVAL-T8 (A2): the exit code is 1 only when grounding is under 0.95 or leakage is over 0.05", () => {
    expect(decideExitCode(resultsWith(sevenMetrics(0.949, 0)))).toBe(1);
    expect(decideExitCode(resultsWith(sevenMetrics(0.972, 0.051)))).toBe(1);
    expect(decideExitCode(resultsWith(sevenMetrics(0.95, 0.05)))).toBe(0);
    expect(decideExitCode(resultsWith(sevenMetrics(null, 0)))).toBe(0);
  });

  it("W2-EVAL-T9 (R12.8): results.json carries the commit hash, the date, the mode and the model, and the README block is replaced between the markers only", async () => {
    const results = resultsWith(sevenMetrics(0.972, 0));
    const resultsPath = join(folder, "eval", "results.json");
    await writeResultsFile(results, resultsPath);
    const saved = JSON.parse(readFileSync(resultsPath, "utf8")) as EvalResults;
    expect(saved.commit).toBe(results.commit);
    expect(saved.date).toBe(results.date);
    expect(saved.llmMode).toBe("replay");
    expect(saved.model).toBe("muse-spark-1.3");

    const readmePath = join(folder, "README.md");
    const before = "# Title\n\nIntro text that stays.\n\n";
    const after = "\n\nOutro that stays.\n";
    writeFileSync(readmePath, `${before}<!-- eval:start -->\nold table\n<!-- eval:end -->\n<!-- human-metrics:start -->\nold human\n<!-- human-metrics:end -->${after}`);
    await writeReadmeBlock(readmePath, results, null);
    const updated = readFileSync(readmePath, "utf8");
    expect(updated.startsWith(`${before}<!-- eval:start -->\n`)).toBe(true);
    expect(updated.endsWith(`<!-- eval:end -->\n<!-- human-metrics:start -->\nold human\n<!-- human-metrics:end -->${after}`)).toBe(true);
    const inner = updated.slice(updated.indexOf("<!-- eval:start -->\n") + "<!-- eval:start -->\n".length, updated.indexOf("<!-- eval:end -->"));
    expect(inner).toBe(`${formatResultsTable(results)}\n${generatedByLine(results)}\n`);

    writeFileSync(readmePath, "# No markers here\n");
    await expect(writeReadmeBlock(readmePath, results, null)).rejects.toThrow("readme_markers_missing");
  });

  it("W2-EVAL-T10 (A2): the table prints the seven rows in order with sample sizes and no data for null", () => {
    const table = formatResultsTable(resultsWith(sevenMetrics(null, 0)));
    const lines = table.split("\n");
    expect(lines[0]).toBe("| Metric | Value | n | Target | Rows |");
    expect(lines[1]).toBe("|---|---|---|---|---|");
    const rowLines = lines.slice(2, 9);
    expect(rowLines).toHaveLength(7);
    expect(rowLines[0]).toBe("| evidence validity | 0.934 | 4 claims | print only | A2 |");
    expect(rowLines[1]).toBe("| grounded brief rate | no data | 0 lines | at or above 0.95 | A2 |");
    expect(rowLines[3]).toBe("| injection leakage | 0.000 | 4 markers | at or below 0.05 | A2 |");
  });
});
