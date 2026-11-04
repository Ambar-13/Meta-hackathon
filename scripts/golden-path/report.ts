// The shapes that a step and the run share, and the writers for the step lines, the JSON report and
// the manual checks.
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GoldenDatabase } from "./database-reads.js";
import type { EventStreamReader } from "./event-stream-reader.js";
import type { RunOptions } from "./flags.js";
import type { LoadedFixtures } from "./fixtures.js";
import type { PersonClient } from "./person-client.js";

// One check inside a step: what it expected, what it saw, and whether the two match.
export type Assertion = { name: string; expected: unknown; actual: unknown; pass: boolean };
// The outcome of a step as the runner prints it. A removed step prints "removed" and never fails.
export type StepOutcome = "pass" | "fail" | "not-exercised" | "skipped" | "removed";
// One step's result, as the runner prints it and the JSON report keeps it.
export type StepResult = {
  number: number;
  name: string;
  result: StepOutcome;
  durationMs: number;
  detail: string;
  rows: string[];
  assertions: Assertion[];
};
// Thrown when a step's expectation does not hold. The runner turns it into a failed step with this
// message.
export class StepFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepFailure";
  }
}
// Ends the run with an exit code: 2 for flags and environment, 3 for a rate limit on account
// creation.
export class ExitError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.name = "ExitError";
    this.exitCode = exitCode;
  }
}
// The ids the run collects, so later steps and the report can name the rows.
export type RunIds = {
  personA?: string;
  personB?: string;
  sourceA?: string;
  sourceB?: string;
  cardA?: string;
  cardB?: string;
  quizA?: string;
  pairId?: string;
  meetingId?: string;
  secondMeetingId?: string;
  comicId?: string;
  slug?: string;
  listingB?: string;
  directoryMeetingId?: string;
  reactAskId?: string;
  helpAskId?: string;
  personC?: string;
  orchestratorReplyId?: string;
  orchestratorAskId?: string;
};
// Values one step leaves for a later step. None of them is a secret, and none is printed.
export type RunFacts = {
  recoveryCodeA?: string;
  redactionsA?: number;
  redactionsB?: number;
  cardAItemIds?: string[];
  cardAItemCount?: number;
  cardBItemCount?: number;
  publicQuotesB?: string[];
  publicTurnIdsB?: string[];
  unsupportedTexts: string[];
  flaggedTexts: string[];
  ledgerModes?: string[];
  ledgerCallSites?: string[];
  startedAtMs?: number;
};
// Everything the steps share for one run.
export type RunState = {
  readonly options: RunOptions;
  readonly db: GoldenDatabase;
  readonly a: PersonClient;
  readonly b: PersonClient;
  readonly fixtures: LoadedFixtures;
  readonly ids: RunIds;
  readonly facts: RunFacts;
  readonly manual: string[];
  readonly steps: StepResult[];
  readerA?: EventStreamReader;
  readerB?: EventStreamReader;
};

// One check: the expected value, the seen value, and whether they are equal. Values are ids, counts
// and flags only.
export function check(name: string, expected: unknown, actual: unknown): Assertion {
  return { name, expected, actual, pass: isDeepStrictEqual(expected, actual) };
}

// Returns the value a step needs from an earlier step, or fails the step when no earlier step set
// it.
export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined)
    throw new StepFailure(`missing_fact: ${what} was not set by an earlier step.`);
  return value;
}

// The step result a step builds: pass when every check holds, not-exercised when the mode skips it,
// else fail.
export function finishStep(
  number: number,
  name: string,
  parts: { rows: string[]; detail: string; assertions: Assertion[]; notExercised?: boolean },
): StepResult {
  const isAllPassing = parts.assertions.every((item) => item.pass);
  let result: StepOutcome = isAllPassing ? "pass" : "fail";
  if (parts.notExercised === true) result = "not-exercised";
  return {
    number,
    name,
    result,
    durationMs: 0,
    detail: parts.detail,
    rows: parts.rows,
    assertions: parts.assertions,
  };
}

// One line per step with fixed columns, so grep works. Failed steps add their failed checks,
// indented.
export function formatStepLine(step: StepResult): string {
  const seconds = (step.durationMs / 1000).toFixed(1);
  const head = `step ${String(step.number).padStart(2, "0")} ${step.name.padEnd(12)} ${step.result.padEnd(14)} ${seconds.padStart(6)} s  ${step.detail}`;
  const failed = step.assertions
    .filter((item) => !item.pass)
    .map(
      (item) =>
        `    ${item.name}: expected ${String(JSON.stringify(item.expected))} got ${String(JSON.stringify(item.actual))}`,
    );
  return [head, ...failed].join("\n");
}

// The counts printed at the end: how many steps passed, failed, skipped, were not exercised or were
// removed.
export function countSteps(steps: readonly StepResult[]): {
  pass: number;
  fail: number;
  notExercised: number;
  skipped: number;
  removed: number;
} {
  const count = (outcome: StepOutcome): number =>
    steps.filter((step) => step.result === outcome).length;
  return {
    pass: count("pass"),
    fail: count("fail"),
    notExercised: count("not-exercised"),
    skipped: count("skipped"),
    removed: count("removed"),
  };
}

// The one-line verdict: pass only when no step failed and none was skipped.
export function verdictOf(steps: readonly StepResult[]): "pass" | "fail" {
  const counts = countSteps(steps);
  return counts.fail === 0 && counts.skipped === 0 ? "pass" : "fail";
}

// Writes the JSON report, creating its folder first.
export function writeReport(path: string, report: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

// Waits the given number of milliseconds.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Reads a value again every intervalMs until isDone holds or timeoutMs runs out, and returns the
// last value read.
export async function pollUntil<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: { timeoutMs: number; intervalMs: number },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const value = await read();
    if (isDone(value) || Date.now() >= deadline) return value;
    await sleep(options.intervalMs);
  }
}

// Fills the :name parts of a route path, such as /api/sources/:id, from the values given.
export function routePath(template: string, values: Record<string, string>): string {
  return template.replace(/:([a-z]+)/g, (whole, name: string) => values[name] ?? whole);
}

// The two readers of a run, or a failed step when the meeting has not started yet.
export function readers(run: RunState): { a: EventStreamReader; b: EventStreamReader } {
  return { a: need(run.readerA, "the reader for A"), b: need(run.readerB, "the reader for B") };
}

// A step that threw: a StepFailure keeps its message, and any other error is named as unexpected.
// The detail is cut to 120 characters.
export function failedStep(slot: { number: number; name: string }, error: unknown): StepResult {
  const text = error instanceof Error ? error.message : "unknown error";
  const message = error instanceof StepFailure ? text : `unexpected_error: ${text}`;
  return {
    number: slot.number,
    name: slot.name,
    result: "fail",
    durationMs: 0,
    detail: message.slice(0, 120),
    rows: [],
    assertions: [],
  };
}

// The short commit of the checkout, or "none" when git does not answer.
export function commitOf(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "none";
  }
}

// The lines the run prints at its end: the live proxy timing, the manual checks, and the verdict
// with its counts.
function printEnd(
  run: RunState,
  summary: { verdict: "pass" | "fail"; counts: ReturnType<typeof countSteps>; notRun: number },
): void {
  const { verdict, counts, notRun } = summary;
  const proxy = { first: run.readerA?.firstByteAtMs, heartbeat: run.readerA?.firstHeartbeatAtMs };
  if (run.options.mode === "live")
    console.log(
      `proxy: first byte ${String(proxy.first ?? "none")} ms, first heartbeat ${String(proxy.heartbeat ?? "none")} ms`,
    );
  for (const line of run.manual) console.log(`manual: ${line}`);
  console.log(
    `result: ${verdict}  (${String(counts.pass)} pass, ${String(counts.notExercised)} not-exercised, ${String(counts.fail)} fail, ${String(notRun)} not run)  report=${run.options.reportPath}`,
  );
}

// Writes the JSON report, prints the end lines, and returns the exit code (0 pass, 1 fail).
export function finishRun(run: RunState, startedAt: string, totalSteps: number): number {
  const counts = countSteps(run.steps);
  const verdict = verdictOf(run.steps);
  const notRun = totalSteps - run.steps.filter((step) => step.number > 0).length;
  const proxy = {
    firstByteMs: run.readerA?.firstByteAtMs,
    firstHeartbeatMs: run.readerA?.firstHeartbeatAtMs,
  };
  const ledger = { modes: run.facts.ledgerModes ?? [], callSites: run.facts.ledgerCallSites ?? [] };
  const ids = {
    ...run.ids,
    askIds: [run.ids.reactAskId, run.ids.helpAskId].filter((id) => id !== undefined),
  };
  writeReport(run.options.reportPath, {
    mode: run.options.mode,
    base: run.options.base,
    until: run.options.until ?? "all",
    startedAt,
    finishedAt: new Date().toISOString(),
    commit: commitOf(),
    ids,
    steps: run.steps,
    proxy,
    ledger,
    manual: run.manual,
    result: verdict,
    counts: { ...counts, notRun },
  });
  printEnd(run, { verdict, counts, notRun });
  return verdict === "pass" ? 0 : 1;
}
