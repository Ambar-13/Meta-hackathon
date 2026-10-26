import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Kysely } from "kysely";
import { ContractError } from "@meet-first/contracts";
import { makeDatabase, withMeeting, type Database } from "@meet-first/db";
import { requestHash } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import { questionCheckCallArgs, questionCheckMessages } from "../check-question-job.js";
import { claimLabel } from "../prompt-builder.js";
import { drainJobs, makeMeetingTestContext, readSideItems } from "./meeting-test-context.js";
import { chatBodyFor, scriptedRecordedCall, structuredReplyLayout, type ReplyScript, type ScriptedSpeech } from "./scripted-replies.js";

// The golden path's free-text question (specs/checks/golden-path.md step 7.3b).
export const GOLDEN_PATH_FREE_TEXT = "Should we split the work by strengths or by interest?";
// The repository root, from this file's folder five levels down.
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
// The folder of the recorded replies, relative to the repository root.
const FIXTURE_DIR = join(REPO_ROOT, "packages/evals/fixtures/model-replies");
// The meeting id the question fixture's request names; the ledger id is not part of the request body.
const QUESTION_MEETING_ID = "00000000-0000-4000-8000-000000000000";

// One approved item of a side as the golden script quotes it.
type ScriptItem = { claim: string; quote: string; lang: string; gloss: string; turnIndex: number };

// The first four words of a text, split on single spaces and joined with one space.
export function firstWords(text: string): string {
  return text.split(" ").slice(0, 4).join(" ");
}

// The replies of the scripted golden-path meeting, in call order, built from the two sides' approved items (section 4.29).
export async function goldenPathScript(db: Kysely<Database>, meetingId: string): Promise<ReplyScript> {
  const sideA = await readSideItems(db, meetingId, "a");
  const sideB = await readSideItems(db, meetingId, "b");
  const a0 = pick(sideA, 0);
  const b0 = pick(sideB, 0);
  const speech: ScriptedSpeech[] = [
    { text: "", toolCalls: [{ name: "recall", arguments: { query: firstWords(a0.quote) } }] },
    { text: "My human's starting point is that money should follow the work that was agreed, not the hours anyone happened to put in. They care about clear ownership, so each of you owns whole pieces and nobody waits on the other for small calls. If one of you carries more this month, my human wants that said early and written down, then the split adjusted for that month only." },
    { text: "", toolCalls: [{ name: "recall", arguments: { query: firstWords(b0.quote) } }] },
    { text: "My human agrees that ownership should be clear, and differs on one point: they would rather keep the money split equal and balance the work over the next month instead. A month where one person does more is normal for them, and they do not want to reopen the split every time it happens. What my human has not said is how long an imbalance can last before it should change." },
    { text: "On your point about balancing over time, my human can accept an equal split as the default, as long as a month that runs far over is named in writing at the time, not remembered later. Which evenings my human can give in a heavy month is something my human has not said, so that stays open between the two of you." },
    { text: "That works as a default for my human too: equal split, with a heavy month named in writing when it happens. My human would add that the person doing more chooses which piece the other takes next, so the balance comes back through the work and not through money. They want this to stay simple enough that nobody keeps a ledger of hours." },
    { text: "My human likes the idea that the balance comes back through the work. Their worry is the case where one of you cannot take the next piece in time. In that case my human would rather adjust the money for that month than stretch into evenings they cannot give. So the open question is who decides when a month counts as far over." },
    { text: "My human would decide that together, at the end of the month, with both of you looking at what was agreed and what was delivered. They do not want one person to judge it alone. If the two of you disagree, my human would keep the equal split for that month and talk again before the next one starts." },
    { text: "That is close to my human's view. The one difference left is timing: my human wants the heavy month named when it starts, not only judged at the end, so neither of you is surprised. Everything else lines up: equal by default, adjusted only by agreement, and written down each time." },
    { text: "My human can name a heavy month when it starts, as long as naming it does not change the money by itself. The end-of-month look still decides. So the two of you agree on the default and on writing things down, and differ only on whether an early warning should already move the split." },
    { text: "", toolCalls: [{ name: "concede", arguments: { claimId: claimLabel(2, 1), reason: "My human can accept the other side's point on this." } }] },
    { text: "My human accepts the equal split as the default and the end-of-month look as the decision point. They keep one thing: a heavy month is named in writing when it starts. The first thing to settle is who writes that note and where it lives." },
    { text: "My human keeps the equal split unless both of you agree at the end of the month, and accepts naming a heavy month early as a warning only. The first thing to settle is the same: one shared place where those notes are written." },
  ];
  const receipts: unknown[] = [
    { claims: [claimOf(pick(sideA, 0))] },
    { claims: [claimOf(pick(sideB, 0))] },
    { claims: [claimOf(pick(sideA, 1))] },
    { claims: [claimOf(pick(sideB, 1))] },
    { claims: [claimOf(pick(sideA, 2))] },
    { claims: [claimOf(pick(sideB, 2))] },
    { claims: [claimOf(pick(sideA, 3))] },
    { claims: [claimOf(pick(sideB, 3))] },
    { claims: [] },
    { claims: [] },
  ];
  return { speech, receipts, questionCheck: [] };
}

// Writes the question_check fixture of GOLDEN_PATH_FREE_TEXT under the repository fixture root; needs no database. Returns the path.
export async function writeQuestionCheckFixture(): Promise<string> {
  const prompt = readPrompt("question-check");
  const args = questionCheckCallArgs({ meetingId: QUESTION_MEETING_ID, promptVersion: prompt.version, messages: questionCheckMessages(prompt.text, GOLDEN_PATH_FREE_TEXT) });
  const body = chatBodyFor(args, false);
  const folder = join(FIXTURE_DIR, "question_check");
  const path = join(folder, requestHash(body) + ".json");
  const response = structuredReplyLayout({ allowed: true, reason: "A plain question about how two people would share work." });
  await mkdir(folder, { recursive: true });
  await writeFile(path, JSON.stringify(scriptedRecordedCall({ callSite: "question_check", promptVersion: prompt.version, body }, response), null, 2) + "\n");
  return path;
}

// Runs the stopped golden-path meeting to its end with the scripted replies and writes its fixtures; returns the paths.
export async function writeMeetingFixtures(options: { workerUrl: string; meetingId: string }): Promise<string[]> {
  const db = makeDatabase(options.workerUrl, 4);
  try {
    const meeting = await withMeeting(db, options.meetingId, (trx) => trx.selectFrom("meetings").select(["state", "started_at", "current_step_seq"]).where("id", "=", options.meetingId).executeTakeFirst());
    if (meeting === undefined || meeting.state !== "running" || meeting.current_step_seq !== 1 || meeting.started_at === null) {
      throw new ContractError("golden_meeting_not_at_start", "Run the golden path until it waits at step 8 (stream), stop the worker, then run this command with that meeting id.", 400);
    }
    const test = await makeMeetingTestContext({ db, script: await goldenPathScript(db, options.meetingId), clockStart: new Date(meeting.started_at.getTime() + 1000), fixtureRoot: FIXTURE_DIR });
    try {
      await test.context.enqueue("meeting_step", { meetingId: options.meetingId, stepSeq: 1 });
      for (let loop = 0; loop < 30 && !(await isEnded(db, options.meetingId)); loop += 1) {
        await drainJobs(test, { limit: 50, names: ["meeting_step"], stepGapMs: 5_000 });
      }
      if (!(await isEnded(db, options.meetingId))) throw new ContractError("golden_meeting_did_not_end", "The scripted golden meeting did not end within 30 rounds. Check the script against the steps.", 500);
      const remaining = test.client.remaining();
      if (remaining.speech + remaining.receipts + remaining.questionCheck > 0) throw new ContractError("golden_script_unused", "The golden script has replies that were not used. Check the meeting's step count.", 500);
      return test.client.written;
    } finally {
      await test.close();
    }
  } finally {
    await db.destroy();
  }
}

// The one card item of a side at this index, wrapped so the position is never past the list.
function pick(items: readonly ScriptItem[], k: number): ScriptItem {
  const item = items[k % items.length];
  if (item === undefined) throw new ContractError("golden_items_missing", "The golden meeting has no approved items for this side. Check the card build.", 500);
  return item;
}

// A verified card quote as a receipt claim, so every scripted receipt passes the quote check.
function claimOf(item: ScriptItem): { text: string; quote: string; turn_id: string; lang: string; gloss: string } {
  return { text: item.claim, quote: item.quote, turn_id: String(item.turnIndex), lang: item.lang, gloss: item.gloss };
}

// True when the meeting has ended.
async function isEnded(db: Kysely<Database>, meetingId: string): Promise<boolean> {
  const row = await withMeeting(db, meetingId, (trx) => trx.selectFrom("meetings").select("state").where("id", "=", meetingId).executeTakeFirst());
  return row?.state === "ended";
}

// The command entry: "question" writes the question-check fixture; "meeting <id>" writes the meeting's fixtures. Each prints its paths.
async function main(argv: readonly string[]): Promise<string[]> {
  if (argv[0] === "question") return [await writeQuestionCheckFixture()];
  const meetingId = argv[1];
  if (argv[0] === "meeting" && meetingId !== undefined) return writeMeetingFixtures({ workerUrl: process.env.DATABASE_URL_WORKER ?? "", meetingId });
  throw new ContractError("golden_command_unknown", "Use the word question, or the word meeting and a meeting id.", 400);
}

// Runs the command when this file is the process entry; importing it for tests starts nothing.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (paths) => {
      for (const path of paths) process.stdout.write(path + "\n");
    },
    (error: unknown) => {
      const line = error instanceof ContractError ? error.code + ": " + error.message : "golden_failed: " + String(error);
      process.stderr.write(line + "\n");
      process.exitCode = 1;
    },
  );
}
