// The entry point of pnpm eval: runs the pairs through the product, computes the metrics, prints the table, and sets the exit code.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Health, routes } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, type Database } from "@meet-first/db";
import type { Kysely } from "kysely";
import { collectRows } from "./collect-rows.js";
import { EvalFailure, parseEvalFlags, REPO_ROOT, type EvalFlags } from "./eval-flags.js";
import { countPlantedSurvivors, findPersonFixture, type PersonFixture } from "./fixture-people.js";
import { drivePair, type DrivenPair, type PairSpec } from "./drive-pair.js";
import { computeAllMetrics, parseTargets, type MetricResult } from "./metrics/index.js";
import { decideExitCode, formatResultsTable, generatedByLine, thresholdFailuresOf, thresholdLinesOf, writeReadmeBlock, writeResultsFile, type EvalResults } from "./results-writer.js";
import { buildHumanTable } from "./human-table.js";

// How many pairs run at once: the replay stack stays calm and the live run stays under the daily cap (ARCHITECTURE.md 4.10).
const PAIRS_IN_FLIGHT = 4;
// The folder of the human response files, and the planted secrets file (4.9).
const RESPONSES_DIR = join(REPO_ROOT, "packages", "evals", "fixtures", "human", "responses");
const PLANTED_FILE = join(REPO_ROOT, "packages", "evals", "fixtures", "secrets", "planted.ndjson");
// The longest the health read may take before the api counts as unreachable.
const HEALTH_TIMEOUT_MS = 10_000;

// The pair list as the file must hold it: at least one pair, each with its two people files and its question.
const PairsFile = z
  .array(
    z
      .object({
        a: z.string(),
        b: z.string(),
        questionId: z.number().int().min(1).max(12),
        recallA: z.boolean(),
        recallB: z.boolean(),
        injection: z.enum(["a", "b"]).optional(),
        injectionFile: z.string().optional(),
      })
      .strict(),
  )
  .min(1);
// One pair that did not finish, recorded with its code.
type PairError = { pair: string; code: string };

// Reads the commit the numbers came from, so the results file names it (R12.8).
function commitHash(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

// The stable code of a failed pair: an EvalFailure keeps its own code; anything else is a request that failed.
function codeOf(error: unknown): string {
  return error instanceof EvalFailure ? error.code : "eval_request_failed";
}

// Checks that the api answers its health route before any pair runs. A worker heartbeat that is absent is only a warning.
async function checkApi(flags: EvalFlags): Promise<void> {
  const reply = await fetch(flags.baseUrl + routes.people.health.path, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) }).catch(() => undefined);
  if (reply === undefined || reply.status !== 200) throw new EvalFailure("eval_api_unreachable", "Start the api and worker, or check --base.");
  const health = Health.safeParse((await reply.json()) as unknown);
  if (!health.success) throw new EvalFailure("eval_api_unreachable", "Start the api and worker, or check --base.");
  if (!health.data.worker) console.log("warning: worker heartbeat absent; pairs will wait for the worker.");
}

// Reads the pair list and refuses a file that does not match it.
async function loadPairs(path: string): Promise<PairSpec[]> {
  const invalid = new EvalFailure("eval_pairs_invalid", `The pairs file ${path} is missing or does not match the pair list shape.`);
  const text = await readFile(path, "utf8").catch(() => {
    throw invalid;
  });
  const parsed = PairsFile.safeParse(JSON.parse(text) as unknown);
  if (!parsed.success) throw invalid;
  return parsed.data;
}

// Finds the people fixtures the pairs name. A missing file is left out here and reported per pair by drivePair.
function fixturesFor(specs: readonly PairSpec[]): Map<string, PersonFixture> {
  const fixtures = new Map<string, PersonFixture>();
  for (const name of specs.flatMap((spec) => [spec.a, spec.b])) {
    const fixture = findPersonFixture(name);
    if (fixture !== undefined) fixtures.set(name, fixture);
  }
  return fixtures;
}

// Runs the pairs with at most PAIRS_IN_FLIGHT in flight. A failed pair is recorded with its code, and the run goes on.
async function driveAll(specs: readonly PairSpec[], flags: EvalFlags, fixtures: Map<string, PersonFixture>): Promise<{ driven: DrivenPair[]; errors: PairError[] }> {
  const driven: DrivenPair[] = [];
  const errors: PairError[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    for (let index = next; index < specs.length; index = next) {
      next = index + 1;
      const spec = specs[index];
      if (spec === undefined) return;
      try {
        driven.push(await drivePair(spec, flags, fixtures));
      } catch (error) {
        errors.push({ pair: `${spec.a} vs ${spec.b}`, code: codeOf(error) });
        console.log(`pair ${spec.a} vs ${spec.b} stopped: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAIRS_IN_FLIGHT, specs.length) }, lane));
  return { driven, errors };
}

// The models the run's ledger rows name, joined in a fixed order; a run with no model call says so.
function modelsOf(rows: { ledger: { model: string }[] }): string {
  const models = [...new Set(rows.ledger.map((row) => row.model))].sort();
  return models.length === 0 ? "none recorded" : models.join(", ");
}

// Reads the scrub-planted secrets count and the targets, then builds the results of the run.
function buildResults(input: { flags: EvalFlags; driven: DrivenPair[]; errors: PairError[]; metrics: MetricResult[]; model: string }): EvalResults {
  const planted = countPlantedSurvivors(PLANTED_FILE);
  return {
    commit: commitHash(),
    date: new Date().toISOString(),
    llmMode: input.flags.mode === "live" ? "live" : "replay",
    model: input.model,
    baseUrl: input.flags.baseUrl,
    pairsRun: input.driven.length,
    pairErrors: input.errors,
    metrics: input.metrics,
    thresholdFailures: thresholdFailuresOf(input.metrics),
    scrubPlantedSurvivors: planted.survivors,
    scrubPlantedTotal: planted.total,
  };
}

// Reads the targets file into the targets the metrics are judged against.
async function readTargets(path: string): Promise<ReturnType<typeof parseTargets>> {
  const text = await readFile(path, "utf8");
  return parseTargets(JSON.parse(text) as unknown);
}

// Runs the pairs and prints the table: the whole path of a replay or a live run.
async function runPairs(flags: EvalFlags): Promise<number> {
  if (flags.databaseUrl === "") throw new EvalFailure("eval_database_missing", "Set DATABASE_URL_WORKER to the database behind the api.");
  await checkApi(flags);
  const specs = await loadPairs(flags.pairsPath);
  const db: Kysely<Database> = makeDatabase(flags.databaseUrl, POOL_SIZE.test);
  try {
    const { driven, errors } = await driveAll(specs, flags, fixturesFor(specs));
    const rows = await collectRows(db, driven);
    const metrics = computeAllMetrics(rows, await readTargets(flags.targetsPath));
    const results = buildResults({ flags, driven, errors, metrics, model: modelsOf(rows) });
    console.log(formatResultsTable(results));
    for (const line of thresholdLinesOf(results)) console.log(line);
    console.log(generatedByLine(results));
    await writeResultsFile(results, flags.resultsPath);
    return decideExitCode(results);
  } finally {
    await db.destroy();
  }
}

// Prints the human table from the response files.
async function printHuman(): Promise<number> {
  const { table } = await buildHumanTable(RESPONSES_DIR);
  console.log(table);
  return 0;
}

// Writes the eval block and the human block into the README, from the results file of the last run.
async function writeReadme(flags: EvalFlags): Promise<number> {
  const text = await readFile(flags.resultsPath, "utf8").catch(() => {
    throw new EvalFailure("results_missing", "Run pnpm eval --replay or --live first.");
  });
  const results = JSON.parse(text) as EvalResults;
  const { table } = await buildHumanTable(RESPONSES_DIR);
  await writeReadmeBlock(flags.readmePath, results, table);
  console.log(`README updated at ${flags.readmePath}.`);
  return 0;
}

// Parses the command, then runs the mode it names.
async function main(): Promise<number> {
  const flags = parseEvalFlags(process.argv.slice(2), process.env);
  if (flags.mode === "human") return printHuman();
  if (flags.mode === "write-readme") return writeReadme(flags);
  return runPairs(flags);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof EvalFailure) {
      console.error(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    console.error(`eval_unexpected: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  },
);
