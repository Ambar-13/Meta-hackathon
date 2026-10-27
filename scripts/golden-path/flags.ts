// The command-line flags of the golden path, the run options they make, the usage text, and the step selection for --until.
import { ExitError } from "./report.js";

// Which worker mode the run expects: live, replay (mock), record, or neither (no ledger assertion).
export type RunMode = "live" | "mock" | "record" | "none";
// The run options the flags make.
export type RunOptions = { base: string; until: string | undefined; mode: RunMode; reportPath: string };
// The step names in order, as --until takes them. Steps 9 and 10 stay in the list, because they are removed steps that keep their numbers.
export const STEP_NAMES = [
  "person", "paste", "card-a", "upload-b", "quiz", "approve", "pair", "stream", "ask", "ask-timeout", "background", "decide", "brief", "comic", "share",
  "sharing", "directory", "dir-decide", "dir-brief", "friend-ask", "help", "delete",
] as const;
// The origin the script drives when --base is not given.
export const DEFAULT_BASE = "http://localhost:3000";
// One step's number and name, as the runner selects them.
export type StepSlot = { number: number; name: string };

// The usage text that --help and a bad flag print.
export function usageText(): string {
  return [
    "usage: pnpm golden-path [--base <url>] [--until <step>] [--live | --mock | --record] [--report <path>]",
    `  --base    the origin to drive (default ${DEFAULT_BASE})`,
    `  --until   run the steps before this one, not the named one (${STEP_NAMES.join(", ")})`,
    "  --live    the worker runs in live mode; the ledger must say live",
    "  --mock    the worker runs in replay mode over the recorded fixtures; the ledger must say replay",
    "  --record  the worker runs in record mode; the ledger must say record; the quiz is skipped as under --mock, so the recording replays",
    "  --report  where the JSON report goes (default docs/evidence/golden-path/<time>.json)",
  ].join("\n");
}

// The steps the run covers: all of them, or the ones before --until.
export function selectSteps(until: string | undefined): StepSlot[] {
  const slots = STEP_NAMES.map((name, index) => ({ number: index + 1, name }));
  if (until === undefined) return slots;
  const cut = STEP_NAMES.findIndex((name) => name === until);
  if (cut < 0) throw new ExitError(2, `golden_path_unknown_step: use one of ${STEP_NAMES.join(", ")}.`);
  return slots.slice(0, cut);
}

// The flags that take a value after them.
const VALUE_FLAGS = new Set(["--base", "--until", "--report"]);
// The flags that stand alone.
const SWITCH_FLAGS = new Set(["--live", "--mock", "--record"]);

// Reads the flags into a map. Values are strings and switches are "true". A flag it does not know, or a value flag with no value, exits 2.
function readArguments(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw new ExitError(2, `golden_path_flags_value: ${arg} needs a value after it.`);
      values.set(arg, value);
      index += 1;
    } else if (SWITCH_FLAGS.has(arg)) {
      values.set(arg, "true");
    } else {
      throw new ExitError(2, `golden_path_flags_unknown: ${arg} is not a flag this command knows. Run with --help to see them.`);
    }
  }
  return values;
}

// The mode the switches ask for. More than one switch at once exits 2.
function modeOf(values: ReadonlyMap<string, string>): RunMode {
  const chosen = (["--live", "--mock", "--record"] as const).filter((flag) => values.has(flag));
  if (chosen.length > 1) throw new ExitError(2, "golden_path_flags_conflict: pass one of --live, --mock or --record.");
  if (chosen[0] === "--live") return "live";
  if (chosen[0] === "--mock") return "mock";
  return chosen[0] === "--record" ? "record" : "none";
}

// Turns the command line into the run options. A bad flag, an unknown step or both --live and --mock exits 2.
export function parseFlags(argv: readonly string[]): RunOptions {
  const values = readArguments(argv);
  const mode = modeOf(values);
  const until = values.get("--until");
  if (until !== undefined && !(STEP_NAMES as readonly string[]).includes(until)) {
    throw new ExitError(2, `golden_path_unknown_step: use one of ${STEP_NAMES.join(", ")}.`);
  }
  const stamp = new Date().toISOString().replace(/:/g, "-");
  return {
    base: values.get("--base") ?? DEFAULT_BASE,
    until,
    mode,
    reportPath: values.get("--report") ?? `docs/evidence/golden-path/${stamp}.json`,
  };
}
