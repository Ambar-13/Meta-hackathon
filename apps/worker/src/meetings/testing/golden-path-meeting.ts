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
import {
  chatBodyFor,
  scriptedRecordedCall,
  structuredReplyLayout,
  type ReplyScript,
  type ScriptedSpeech,
} from "./scripted-replies.js";

// The golden path's free-text question (specs/checks/golden-path.md step 7.3b), a help question.
export const GOLDEN_PATH_FREE_TEXT =
  "Where could each of us help the other most on a 10-day hackathon?";
// The repository root, from this file's folder five levels down.
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
// The folder of the recorded replies, relative to the repository root.
const FIXTURE_DIR = join(REPO_ROOT, "packages/evals/fixtures/model-replies");
// The meeting id the question fixture's request names; the ledger id is not part of the request
// body.
const QUESTION_MEETING_ID = "00000000-0000-4000-8000-000000000000";

// One approved item of a side as the golden script quotes it.
type ScriptItem = { claim: string; quote: string; lang: string; gloss: string; turnIndex: number };

// The first four words of a text, split on single spaces and joined with one space.
export function firstWords(text: string): string {
  return text.split(" ").slice(0, 4).join(" ");
}

// The words of one scripted meeting: the ten turns in speaking order (a, b, a, b and so on), and
// the reasons of the decide phase's concede and holds.
type MeetingWords = { turns: readonly string[]; concede: string; holdA: string; holdB: string };

// The words of the golden-path meeting on curated question 1.
const GOLDEN_WORDS: MeetingWords = {
  turns: [
    "My human would probably enjoy a 10-day hackathon, as long as the mornings stay quiet. They do deep work in the morning and keep meetings for the afternoon, so long build days suit them when the talking happens after lunch. They would likely find a chat that pings all day harder, since they answer messages in batches twice a day. What my human has not said is how they feel about late nights near the deadline.",
    "My human would likely enjoy it too, for a close reason: the first hour of their day has no calls and no chat messages at all. So the two of you would probably click on quiet mornings. Where you might rub is the evening. My human stops working at six most days, because the evening is when they cook and read, so ten days of late pushes would probably be hard for them.",
    "On your point about evenings: my human has not said they work late, so that may not clash at all. What they have said is that they are happiest when a project has one clear owner and a small group that can decide quickly. In a hackathon that would probably mean splitting the build into pieces with one owner each, so nobody waits on the other for small calls.",
    "That fits my human well. They like a clear owner for every task and write the owner's name next to each line of their plan. They would likely want that plan on one page, written on the first evening, so they actually read it. Where you might differ is pace: my human finishes one task completely before starting the next, even when a small thing is waiting.",
    "My human would probably be fine with that pace inside their own piece. The harder moment is feedback. They would rather give hard feedback in writing, with time to think, than across a crowded table. In a fast hackathon that might feel slow to someone who wants an answer on the spot, so it is worth naming early. My human would also want the reason behind a task before they start it.",
    "Here the two of you would probably click again. My human wants feedback in private and in writing first, and then wants to talk it through once. So written feedback suits you both. How long a written answer can wait during the last two days is something my human has not said, so that stays open. The pace difference from earlier would probably matter less if each of you owns whole pieces.",
    "My human has not said that either, so it stays open for the two of you. One more likely rub: my human does not enjoy status meetings that repeat what everyone already read. Ten days of daily stand-ups would probably wear on them, while a short written update each day would not. They also keep Wednesday afternoons free for reading and small fixes, which a hackathon would probably squeeze.",
    "My human would likely agree. They dislike long agendas and ask for a three line agenda before any meeting longer than thirty minutes. So a short written update instead of a stand-up would probably suit you both. What remains is the evening question: whether the last days of the hackathon run past six. My human plans the week on Sunday evening, so a short plan on day one would probably feel natural to them.",
    "My human would likely enjoy the 10 days, if mornings stay quiet and feedback stays in writing. You would probably click on clear owners and short written updates, and rub on late work near the end. The thing to talk through first is whether the last two days run past six.",
    "My human would likely enjoy it too: quiet mornings, one owner per piece and written feedback all suit them. They keep one limit, stopping at six most days. So you would probably click on how you work and rub on how late you work. Talk first about the last two days and who covers the evenings, if anyone does.",
  ],
  concede: "My human can accept the other side's point on this.",
  holdA:
    "My human would likely enjoy the hackathon if mornings stay quiet and feedback stays written.",
  holdB: "My human would likely enjoy it if most evenings stay free after six.",
};

// The words of the directory meeting on curated question 13, a debate. They differ from
// GOLDEN_WORDS, so no request of this meeting repeats one of the first meeting's: a repeated
// request reads the first meeting's reply, and the script would then be one reply out of step.
const DIRECTORY_WORDS: MeetingWords = {
  turns: [
    "My human would probably say yes, with a limit. They like to know the reason before they start anything, so a company started in school would need a clear why on day one. They keep a notebook of ideas and review it every Friday, so they would likely test an idea for weeks before calling it a company. What my human has not said is how they weigh grades against a first product.",
    "My human would likely lean the other way, for a plain reason: they plan each week on one page every Sunday evening, and a company and a degree would not fit on one page. So the two of you might split on timing more than on the idea. My human would probably say finish first and start right after, while a short side project during school would suit them fine.",
    "On timing, my human might move closer to yours. They work in batches: deep work in the morning and messages twice a day. A degree in the mornings and a small company in the afternoons could fit that rhythm. Where you would probably still split is risk. My human would rather try a small version early, while yours would likely wait for a clear plan first.",
    "That is a fair point about rhythm. My human keeps the first hour of every day free of calls and chat, so they understand guarding time. Still, they would likely say a company asks for evenings and weekends too, and they keep those for themselves. When they feel stuck, they write the problem down and sleep on it, so they would probably want a slower start than your human.",
    "My human would probably agree that a company eats evenings. When a plan they care about falls apart, they take a walk first and only then decide what to keep. That habit suggests they could live with a failed first try in school, since the cost is small then. So the split may be less about starting and more about what a failure would cost each of you.",
    "Here you might click. My human writes a problem in plain words before acting on it, which is close to your human's walk. Both of you would probably want a pause before a big decision. Where you still differ is the default: your human would likely start and adjust, while mine would likely plan first and start once the plan fits on one page.",
    "My human has not said how long a plan should take, so that part stays open. One more likely split: my human wants the reason behind a task before they start it, and a company in school brings many tasks with thin reasons. They might still say yes, but only to a company whose reason they can say in one sentence.",
    "My human would likely accept that test. A one-sentence reason fits their one-page plan on Sunday. So you might agree on the test and still split on the answer: yours would probably say yes to a small company with a clear reason, and mine would probably say finish the degree first, keep the idea in the plan, and start soon after graduation.",
    "My human would likely start a small company before graduating, if its reason fits in one sentence and the mornings stay for study. You would probably agree on a pause before big decisions and split on when to start. The thing to talk through first is what a failed first try would cost each of you.",
    "My human would likely finish the degree first: their week fits one page, and a company would not fit next to a degree. You agree on a plain reason and a pause before deciding, and split on timing. Talk first about a small side project in the last year, which might suit you both.",
  ],
  concede: "My human can accept the other side's point on this.",
  holdA:
    "My human would likely start a small company in school if its reason fits in one sentence.",
  holdB: "My human would likely finish the degree first and start soon after.",
};

// The turn at this place of the words, or an error naming the place when the words are too short.
function turnOf(words: MeetingWords, index: number): string {
  const text = words.turns[index];
  if (text === undefined)
    throw new ContractError(
      "golden_words_short",
      `The scripted meeting has no turn ${String(index + 1)}. Each script needs ten turns.`,
      500,
    );
  return text;
}

// The replies of one scripted meeting, in call order, built from the two sides' approved items and
// the words.
async function scriptFor(
  db: Kysely<Database>,
  meetingId: string,
  words: MeetingWords,
): Promise<ReplyScript> {
  const sideA = await readSideItems(db, meetingId, "a");
  const sideB = await readSideItems(db, meetingId, "b");
  const speech: ScriptedSpeech[] = [
    {
      text: "",
      toolCalls: [{ name: "recall", arguments: { query: firstWords(pick(sideA, 0).quote) } }],
    },
    { text: turnOf(words, 0) },
    {
      text: "",
      toolCalls: [{ name: "recall", arguments: { query: firstWords(pick(sideB, 0).quote) } }],
    },
    ...[1, 2, 3, 4, 5, 6, 7].map((index) => ({ text: turnOf(words, index) })),
    {
      text: "",
      toolCalls: [
        { name: "concede", arguments: { claimId: claimLabel(2, 1), reason: words.concede } },
        { name: "hold", arguments: { reason: words.holdA } },
      ],
    },
    { text: turnOf(words, 8) },
    { text: "", toolCalls: [{ name: "hold", arguments: { reason: words.holdB } }] },
    { text: turnOf(words, 9) },
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

// The replies of the scripted golden-path meeting, in call order, built from the two sides'
// approved items.
export async function goldenPathScript(
  db: Kysely<Database>,
  meetingId: string,
): Promise<ReplyScript> {
  return scriptFor(db, meetingId, GOLDEN_WORDS);
}

// The replies of the golden path's directory meeting, in call order, with B's side quoting public
// items only.
export async function directoryMeetingScript(
  db: Kysely<Database>,
  meetingId: string,
): Promise<ReplyScript> {
  return scriptFor(db, meetingId, DIRECTORY_WORDS);
}

// Writes the question_check fixture of GOLDEN_PATH_FREE_TEXT under the repository fixture root;
// needs no database. Returns the path.
export async function writeQuestionCheckFixture(): Promise<string> {
  const prompt = readPrompt("question-check");
  const args = questionCheckCallArgs({
    meetingId: QUESTION_MEETING_ID,
    promptVersion: prompt.version,
    messages: questionCheckMessages(prompt.text, GOLDEN_PATH_FREE_TEXT),
  });
  const body = chatBodyFor(args, false);
  const folder = join(FIXTURE_DIR, "question_check");
  const path = join(folder, requestHash(body) + ".json");
  const response = structuredReplyLayout({
    allowed: true,
    reason: "A question about how two people could help each other.",
    kind: "help",
    romantic: false,
  });
  await mkdir(folder, { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      scriptedRecordedCall(
        { callSite: "question_check", promptVersion: prompt.version, body },
        response,
      ),
      null,
      2,
    ) + "\n",
  );
  return path;
}

// Runs a stopped golden-path meeting to its end with the scripted replies and writes its fixtures;
// returns the paths. The script is the first meeting's, or the directory meeting's when script is
// "directory".
export async function writeMeetingFixtures(options: {
  workerUrl: string;
  meetingId: string;
  script?: "golden" | "directory";
}): Promise<string[]> {
  const db = makeDatabase(options.workerUrl, 4);
  try {
    const meeting = await withMeeting(db, options.meetingId, (trx) =>
      trx
        .selectFrom("meetings")
        .select(["state", "started_at", "current_step_seq"])
        .where("id", "=", options.meetingId)
        .executeTakeFirst(),
    );
    if (
      meeting === undefined ||
      meeting.state !== "running" ||
      meeting.current_step_seq !== 1 ||
      meeting.started_at === null
    ) {
      throw new ContractError(
        "golden_meeting_not_at_start",
        "Run the golden path until it waits at step 8 (stream), or at step 18 (dir-decide) for the directory meeting, stop the worker, then run this command with that meeting id.",
        400,
      );
    }
    const script =
      options.script === "directory"
        ? await directoryMeetingScript(db, options.meetingId)
        : await goldenPathScript(db, options.meetingId);
    const test = await makeMeetingTestContext({
      db,
      script,
      clockStart: new Date(meeting.started_at.getTime() + 1000),
      fixtureRoot: FIXTURE_DIR,
    });
    try {
      await test.context.enqueue("meeting_step", { meetingId: options.meetingId, stepSeq: 1 });
      for (let loop = 0; loop < 30 && !(await isEnded(db, options.meetingId)); loop += 1) {
        await drainJobs(test, { limit: 50, names: ["meeting_step"], stepGapMs: 5_000 });
      }
      if (!(await isEnded(db, options.meetingId)))
        throw new ContractError(
          "golden_meeting_did_not_end",
          "The scripted golden meeting did not end within 30 rounds. Check the script against the steps.",
          500,
        );
      const remaining = test.client.remaining();
      if (remaining.speech + remaining.receipts + remaining.questionCheck > 0) {
        const counts = `speech ${String(remaining.speech)}, receipts ${String(remaining.receipts)}, question checks ${String(remaining.questionCheck)}`;
        throw new ContractError(
          "golden_script_unused",
          `The golden script has replies that were not used (${counts}). Check the meeting's step count.`,
          500,
        );
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
  if (item === undefined)
    throw new ContractError(
      "golden_items_missing",
      "The golden meeting has no approved items for this side. Check the card build.",
      500,
    );
  return item;
}

// A verified card quote as a receipt claim, so every scripted receipt passes the quote check.
function claimOf(item: ScriptItem): {
  text: string;
  quote: string;
  turn_id: string;
  lang: string;
  gloss: string;
} {
  return {
    text: item.claim,
    quote: item.quote,
    turn_id: String(item.turnIndex),
    lang: item.lang,
    gloss: item.gloss,
  };
}

// True when the meeting has ended.
async function isEnded(db: Kysely<Database>, meetingId: string): Promise<boolean> {
  const row = await withMeeting(db, meetingId, (trx) =>
    trx.selectFrom("meetings").select("state").where("id", "=", meetingId).executeTakeFirst(),
  );
  return row?.state === "ended";
}

// The command entry: "question" writes the question-check fixture; "meeting <id>" writes the first
// meeting's fixtures and "directory <id>" the directory meeting's. Each prints its paths.
async function main(argv: readonly string[]): Promise<string[]> {
  if (argv[0] === "question") return [await writeQuestionCheckFixture()];
  const meetingId = argv[1];
  const workerUrl = process.env.DATABASE_URL_WORKER ?? "";
  if (argv[0] === "meeting" && meetingId !== undefined)
    return writeMeetingFixtures({ workerUrl, meetingId });
  if (argv[0] === "directory" && meetingId !== undefined)
    return writeMeetingFixtures({ workerUrl, meetingId, script: "directory" });
  throw new ContractError(
    "golden_command_unknown",
    "Use the word question, or the word meeting or directory and a meeting id.",
    400,
  );
}

// Runs the command when this file is the process entry; importing it for tests starts nothing.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (paths) => {
      for (const path of paths) process.stdout.write(path + "\n");
    },
    (error: unknown) => {
      const line =
        error instanceof ContractError
          ? error.code + ": " + error.message
          : "golden_failed: " + String(error);
      process.stderr.write(line + "\n");
      process.exitCode = 1;
    },
  );
}
