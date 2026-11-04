// Parses the command line of pnpm eval into one typed object, and holds the failure type the entry point exits with.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The repository root, found from this file (packages/evals/src), so the defaults work from any folder.
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// The default time one meeting may take before the run gives up on it: 15 minutes.
export const MEETING_TIMEOUT_MS = 900_000;
// The pair list of a replay run: one pair of pairs.json, recorded on its own, because replay answers only recorded requests. It shares no
// person with the golden path, whose recordings would otherwise answer its first calls and lead it off its own recording.
const REPLAY_PAIRS = "packages/evals/fixtures/pairs.replay.json";
// The pair list of a live run: the eight fresh pairs of the eval.
const LIVE_PAIRS = "packages/evals/fixtures/pairs.json";
// The targets the thresholds come from.
const TARGETS = "packages/evals/fixtures/expected/targets.json";
// Where the results file goes by default, at the repository root.
const RESULTS_FILE = "eval/results.json";

// The four ways the command runs: a replay or a live run of the pairs, the human table, or the README block.
export type EvalMode = "replay" | "live" | "human" | "write-readme";
// Everything the run reads from the command line and the environment.
export type EvalFlags = {
  mode: EvalMode;
  baseUrl: string;
  pairsPath: string;
  resultsPath: string;
  readmePath: string;
  targetsPath: string;
  databaseUrl: string;
  timeoutMs: number;
};

// A stopped run: a stable code, a sentence that says what to do next, and the exit code the process ends with.
export class EvalFailure extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, sentence: string, exitCode = 2) {
    super(`${code}: ${sentence}`);
    this.name = "EvalFailure";
    this.code = code;
    this.exitCode = exitCode;
  }
}

// The flags that take a value, by their names on the command line.
const VALUE_FLAGS = new Set(["--base", "--pairs", "--results", "--readme", "--targets"]);
// The flags that choose the mode; exactly one of them must be given.
const MODE_FLAGS: Record<string, EvalMode> = {
  "--replay": "replay",
  "--live": "live",
  "--human": "human",
  "--write-readme": "write-readme",
};

// Reads the flags into a map from name to value (or "" for a switch), refusing any name the command does not know.
function readArguments(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index] ?? "";
    if (name in MODE_FLAGS) {
      values.set(name, "");
    } else if (VALUE_FLAGS.has(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new EvalFailure("eval_bad_flags", `${name} needs a value. Pass it as ${name} VALUE.`);
      values.set(name, value);
      index += 1;
    } else {
      throw new EvalFailure(
        "eval_bad_flags",
        `Unknown flag ${name}. Use one of --replay, --live, --human, --write-readme, and --base, --pairs, --results, --readme, --targets.`,
      );
    }
  }
  return values;
}

// The one mode flag given, or a refusal when there are none or several.
function modeOf(values: Map<string, string>): EvalMode {
  const chosen = Object.keys(MODE_FLAGS).filter((flag) => values.has(flag));
  if (chosen.length !== 1)
    throw new EvalFailure(
      "eval_bad_flags",
      "Pass exactly one of --replay, --live, --human or --write-readme.",
    );
  const flag = chosen[0] ?? "";
  return MODE_FLAGS[flag] ?? "replay";
}

// A path the user passed is read from the folder the command runs in; a default path is read from the repository root.
function pathFlag(values: Map<string, string>, flag: string, fallback: string): string {
  const given = values.get(flag);
  return given === undefined ? resolve(REPO_ROOT, fallback) : resolve(process.cwd(), given);
}

// Parses the command line and the environment into the flags of one run. Exits 2 with eval_bad_flags on a bad command.
export function parseEvalFlags(argv: readonly string[], env: NodeJS.ProcessEnv): EvalFlags {
  const values = readArguments(argv);
  const mode = modeOf(values);
  const base = values.get("--base");
  if (mode === "live" && base === undefined)
    throw new EvalFailure(
      "eval_base_missing",
      "Pass --base https://your-app-origin for a live run.",
    );
  return {
    mode,
    baseUrl: base ?? `http://localhost:${env.PORT ?? "3000"}`,
    pairsPath: pathFlag(values, "--pairs", mode === "live" ? LIVE_PAIRS : REPLAY_PAIRS),
    resultsPath: pathFlag(values, "--results", RESULTS_FILE),
    readmePath: pathFlag(values, "--readme", "README.md"),
    targetsPath: pathFlag(values, "--targets", TARGETS),
    databaseUrl: env.DATABASE_URL_WORKER ?? "",
    timeoutMs: MEETING_TIMEOUT_MS,
  };
}
