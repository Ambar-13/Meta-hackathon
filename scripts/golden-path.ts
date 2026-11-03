// The end-to-end golden path: two simulated people driven through the HTTP routes, one line per step, and an exit code the checks read.
import { checkDatabase, openWorkerDatabase, readLedgerFacts } from "./golden-path/database-reads.js";
import { loadFixtures } from "./golden-path/fixtures.js";
import { parseFlags, selectSteps, STEP_NAMES, usageText, type RunMode, type RunOptions, type StepSlot } from "./golden-path/flags.js";
import { PersonClient, readHealth } from "./golden-path/person-client.js";
import { check, commitOf, ExitError, failedStep, finishRun, finishStep, formatStepLine, type RunState, type StepResult } from "./golden-path/report.js";
import { step01Person, step02Paste, step03CardA, step04UploadB } from "./golden-path/steps-people-and-sources.js";
import { step05Quiz, step06Approve, step07Pair } from "./golden-path/steps-quiz-approve-pair.js";
import { removedStep, step08Stream, step11Background, step12Decide } from "./golden-path/steps-meeting.js";
import { step13Brief, step14Comic, step15Share, step24Delete } from "./golden-path/steps-brief-to-deletion.js";
import { step16Sharing, step17Directory, step18DirectoryDecide, step19DirectoryBrief, step20FriendAsk, step21Help } from "./golden-path/steps-directory-and-asks.js";
import { step22FriendRequest, step23Orchestrator } from "./golden-path/steps-social.js";

// The steps by number, each a function from the run to its result. Steps 9 and 10 are removed, so they print "removed".
// Steps 16 to 21 are the directory, the friend ask and the help search; 22 and 23 are a friend request and the orchestrator chat;
// the deletion is last.
const RUNNERS = new Map<number, (run: RunState) => Promise<StepResult>>([
  [1, step01Person], [2, step02Paste], [3, step03CardA], [4, step04UploadB], [5, step05Quiz], [6, step06Approve], [7, step07Pair],
  [8, step08Stream], [9, () => Promise.resolve(removedStep(9, "ask"))], [10, () => Promise.resolve(removedStep(10, "ask-timeout"))],
  [11, step11Background], [12, step12Decide], [13, step13Brief], [14, step14Comic], [15, step15Share], [16, step16Sharing],
  [17, step17Directory], [18, step18DirectoryDecide], [19, step19DirectoryBrief], [20, step20FriendAsk], [21, step21Help],
  [22, step22FriendRequest], [23, step23Orchestrator], [24, step24Delete],
]);
// A step that fails here stops the run, because the steps after it need what it makes. The removed steps never stop.
const PREREQUISITES = new Set([1, 2, 3, 4, 6, 7, 12, 13, 16, 17, 18]), REMOVED = new Set([9, 10]);

// Runs one step, or marks it skipped when a prerequisite failed. An exit error from a step ends the whole run.
async function runOne(run: RunState, slot: StepSlot, blockedBy: number | undefined): Promise<StepResult> {
  const runner = RUNNERS.get(slot.number);
  if (runner === undefined) throw new ExitError(2, `golden_path_unknown_step: no runner for step ${String(slot.number)}.`);
  if (blockedBy !== undefined && !REMOVED.has(slot.number)) {
    return { number: slot.number, name: slot.name, result: "skipped", durationMs: 0, detail: `skipped: step ${String(blockedBy)} failed`, rows: [], assertions: [] };
  }
  const started = Date.now();
  try {
    return { ...(await runner(run)), durationMs: Date.now() - started };
  } catch (error) {
    if (error instanceof ExitError) throw error;
    return { ...failedStep(slot, error), durationMs: Date.now() - started };
  }
}

// Runs the selected steps in order and prints each line. A failed prerequisite marks the steps after it as skipped.
async function runSteps(run: RunState, slots: readonly StepSlot[]): Promise<void> {
  let blockedBy: number | undefined;
  for (const slot of slots) {
    const result = await runOne(run, slot, blockedBy);
    if (result.result === "fail" && PREREQUISITES.has(slot.number)) blockedBy = slot.number;
    run.steps.push(result);
    console.log(formatStepLine(result));
  }
}

// Reads the ledger modes and call sites now unless an earlier step cached them. False when the run stopped before its people existed.
async function readLedgerNow(run: RunState): Promise<boolean> {
  if (run.facts.ledgerModes !== undefined) return true;
  const { meetingId, personA, personB } = run.ids;
  if (meetingId === undefined || personA === undefined || personB === undefined) return false;
  const ledger = await readLedgerFacts(run.db, meetingId, [personA, personB]);
  run.facts.ledgerModes = ledger.modes;
  run.facts.ledgerCallSites = ledger.callSites;
  return true;
}

// The modes a run expects from the ledger: replay under --mock, live under --live, record under --record, and none otherwise.
function expectedModesOf(mode: RunMode): string[] | undefined {
  if (mode === "mock") return ["replay"];
  if (mode === "record") return ["record"];
  return mode === "live" ? ["live"] : undefined;
}

// The ledger check at the end. The modes and call sites are printed either way, and a run with a mode must match it.
async function endOfRun(run: RunState): Promise<StepResult | undefined> {
  if (!(await readLedgerNow(run))) return undefined;
  const modes = run.facts.ledgerModes ?? [];
  console.log(`ledger modes: ${modes.join(", ") || "none"}`);
  console.log(`ledger call sites: ${(run.facts.ledgerCallSites ?? []).join(", ") || "none"}`);
  const expected = expectedModesOf(run.options.mode);
  if (expected === undefined) return undefined;
  const result = finishStep(0, "mode", { rows: [], detail: `llm_mode is ${expected.join(", ")}`, assertions: [check("the ledger modes match the run mode", expected, modes)] });
  console.log(formatStepLine(result));
  return result;
}

// Checks the api and the database before any step, and loads the fixtures. A failure exits 2 before a step runs.
async function openRun(options: RunOptions): Promise<RunState> {
  const url = process.env.DATABASE_URL_WORKER;
  if (url === undefined || url === "") throw new ExitError(2, "golden_path_env_missing: set DATABASE_URL_WORKER to the database behind --base.");
  const health = await readHealth(options.base);
  if (!health.worker) console.log("warning: worker heartbeat absent; steps 2 onward will wait");
  const db = openWorkerDatabase(url);
  await checkDatabase(db);
  return { options, db, a: new PersonClient("A", options.base), b: new PersonClient("B", options.base), fixtures: loadFixtures(), ids: {}, facts: { unsupportedTexts: [], flaggedTexts: [] }, manual: [], steps: [] };
}

// The whole run: flags, preflight, the steps, the end-of-run check, the report, and the exit code.
async function main(): Promise<number> {
  if (process.argv.includes("--help")) { console.log(usageText()); return 0; }
  const options = parseFlags(process.argv.slice(2));
  const run = await openRun(options);
  const startedAt = new Date().toISOString();
  console.log(`golden-path  mode=${options.mode}  base=${options.base}  until=${options.until ?? "all"}  commit=${commitOf()}`);
  try {
    await runSteps(run, selectSteps(options.until));
    const modeResult = await endOfRun(run);
    if (modeResult !== undefined) run.steps.push(modeResult);
  } finally {
    run.readerA?.close();
    run.readerB?.close();
    await run.db.destroy();
  }
  return finishRun(run, startedAt, STEP_NAMES.length);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const isExit = error instanceof ExitError;
    console.error(isExit ? error.message : `golden_path_unexpected: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = isExit ? error.exitCode : 1;
  },
);
