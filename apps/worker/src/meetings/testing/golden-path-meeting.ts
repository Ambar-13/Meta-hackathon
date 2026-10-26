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

// The golden path's free-text question (specs/checks/golden-path.md step 7.3b), a help question.
export const GOLDEN_PATH_FREE_TEXT = "Where could each of us help the other most on a 10-day hackathon?";
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
    { text: "My human would probably enjoy a 10-day hackathon, as long as the mornings stay quiet. They do deep work in the morning and keep meetings for the afternoon, so long build days suit them when the talking happens after lunch. They would likely find a chat that pings all day harder, since they answer messages in batches twice a day. What my human has not said is how they feel about late nights near the deadline." },
    { text: "", toolCalls: [{ name: "recall", arguments: { query: firstWords(b0.quote) } }] },
    { text: "My human would likely enjoy it too, for a close reason: the first hour of their day has no calls and no chat messages at all. So the two of you would probably click on quiet mornings. Where you might rub is the evening. My human stops working at six most days, because the evening is when they cook and read, so ten days of late pushes would probably be hard for them." },
    { text: "On your point about evenings: my human has not said they work late, so that may not clash at all. What they have said is that they are happiest when a project has one clear owner and a small group that can decide quickly. In a hackathon that would probably mean splitting the build into pieces with one owner each, so nobody waits on the other for small calls." },
    { text: "That fits my human well. They like a clear owner for every task and write the owner's name next to each line of their plan. They would likely want that plan on one page, written on the first evening, so they actually read it. Where you might differ is pace: my human finishes one task completely before starting the next, even when a small thing is waiting." },
    { text: "My human would probably be fine with that pace inside their own piece. The harder moment is feedback. They would rather give hard feedback in writing, with time to think, than across a crowded table. In a fast hackathon that might feel slow to someone who wants an answer on the spot, so it is worth naming early. My human would also want the reason behind a task before they start it." },
    { text: "Here the two of you would probably click again. My human wants feedback in private and in writing first, and then wants to talk it through once. So written feedback suits you both. How long a written answer can wait during the last two days is something my human has not said, so that stays open. The pace difference from earlier would probably matter less if each of you owns whole pieces." },
    { text: "My human has not said that either, so it stays open for the two of you. One more likely rub: my human does not enjoy status meetings that repeat what everyone already read. Ten days of daily stand-ups would probably wear on them, while a short written update each day would not. They also keep Wednesday afternoons free for reading and small fixes, which a hackathon would probably squeeze." },
    { text: "My human would likely agree. They dislike long agendas and ask for a three line agenda before any meeting longer than thirty minutes. So a short written update instead of a stand-up would probably suit you both. What remains is the evening question: whether the last days of the hackathon run past six. My human plans the week on Sunday evening, so a short plan on day one would probably feel natural to them." },
    { text: "", toolCalls: [
      { name: "concede", arguments: { claimId: claimLabel(2, 1), reason: "My human can accept the other side's point on this." } },
      { name: "hold", arguments: { reason: "My human would likely enjoy the hackathon if mornings stay quiet and feedback stays written." } },
    ] },
    { text: "My human would likely enjoy the 10 days, if mornings stay quiet and feedback stays in writing. You would probably click on clear owners and short written updates, and rub on late work near the end. The thing to talk through first is whether the last two days run past six." },
    { text: "", toolCalls: [{ name: "hold", arguments: { reason: "My human would likely enjoy it if most evenings stay free after six." } }] },
    { text: "My human would likely enjoy it too: quiet mornings, one owner per piece and written feedback all suit them. They keep one limit, stopping at six most days. So you would probably click on how you work and rub on how late you work. Talk first about the last two days and who covers the evenings, if anyone does." },
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
  const response = structuredReplyLayout({ allowed: true, reason: "A question about how two people could help each other.", kind: "help" });
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
      if (remaining.speech + remaining.receipts + remaining.questionCheck > 0) {
        const counts = `speech ${String(remaining.speech)}, receipts ${String(remaining.receipts)}, question checks ${String(remaining.questionCheck)}`;
        throw new ContractError("golden_script_unused", `The golden script has replies that were not used (${counts}). Check the meeting's step count.`, 500);
      }
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
