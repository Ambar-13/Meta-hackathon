// The golden path's brief writer, and the seeded ended meeting the brief tests use. The writer answers each brief and judge call
// from the meeting's own rows, writes the reply as a recorded fixture, then lets the replay client answer from it.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Kysely } from "kysely";
import { pino } from "pino";
import { ContractError, EVENT_VERSION } from "@meet-first/contracts";
import { appendMeetingEvent, makeDatabase, POOL_SIZE, withMeeting, type Database } from "@meet-first/db";
import { createPairedMeetingWithTurns, SEED_TURNS_A, SEED_TURNS_B, type SeededMeeting } from "@meet-first/db/testing";
import { makeLlmClient, requestHash, type CompleteArgs, type LlmClient } from "@meet-first/llm";
import { testWorkerEnv } from "@meet-first/llm/testing";
import type { JobContext } from "../../job-context.js";
import { chatBodyFor, scriptedRecordedCall, structuredReplyLayout } from "../../meetings/testing/scripted-replies.js";
import { sourceTurnLabel } from "../brief-lines.js";
import { readBriefSnapshot, writeBriefsTask, type BriefSnapshot } from "../write-briefs-job.js";

// The folder of the recorded replies, five levels above this file's folder.
const FIXTURE_DIR = fileURLToPath(new URL("../../../../../packages/evals/fixtures/model-replies", import.meta.url));
// Lines in each brief, and quotes each side needs for its nine lines (ARCHITECTURE.md 3.19).
const LINE_COUNT = 9;
// The time the seeded meeting starts, fixed so the seed is the same on every run.
const SEED_START = new Date("2026-10-26T10:00:00.000Z");

// One step of the seeded transcript: whose turn it is, its phase, the words spoken and the two claims it makes.
export type SeedStep = { side: "a" | "b"; phase: "explore" | "decide"; text: string; claims: [string, string] };
// The six steps of the seeded meeting; each side speaks three times and each step makes two claims.
export const SEED_STEPS: SeedStep[] = [
  { side: "a", phase: "explore", text: "Mira's persona: my human writes the plan down before any big meeting.", claims: ["Writes the plan down first", "Says the plan out loud before the meeting"] },
  { side: "b", phase: "explore", text: "Jonah's persona: my human talks a plan through out loud before deciding.", claims: ["Talks a plan through out loud", "Decides only after the talk"] },
  { side: "a", phase: "explore", text: "Mira's persona: my human says early when a deadline will slip.", claims: ["Says early when a deadline slips", "Tells the team the same day"] },
  { side: "b", phase: "decide", text: "Jonah's persona: my human moves a deadline only after telling the team.", claims: ["Tells the team before moving a deadline", "Keeps one shared calendar"] },
  { side: "a", phase: "decide", text: "Mira's persona: my human keeps weekends free of the phone.", claims: ["Keeps weekends free of the phone", "Walks or hikes after long days"] },
  { side: "b", phase: "decide", text: "Jonah's persona: my human needs a day to adjust when plans change.", claims: ["Needs a day when plans change", "Says so when plans change"] },
];

// The parameter an event append takes: a committed meeting event without its seq.
type SeedEvent = Parameters<typeof appendMeetingEvent>[2];

// Appends one event to the seeded meeting, in its own meeting context.
async function appendSeedEvent(db: Kysely<Database>, meetingId: string, event: SeedEvent): Promise<void> {
  await withMeeting(db, meetingId, (trx) => appendMeetingEvent(trx, meetingId, event));
}

// Seeds a paired meeting with six committed turns, two claims each, and a start event; ends it unless end is false (then it stays running).
export async function seedBriefMeeting(options: { appDb: Kysely<Database>; workerDb: Kysely<Database>; end: boolean }): Promise<SeededMeeting> {
  const seeded = await createPairedMeetingWithTurns(options.appDb);
  const meetingId = seeded.meetingId;
  const question = await withMeeting(options.workerDb, meetingId, (trx) => trx.selectFrom("meetings").select("question_text").where("id", "=", meetingId).executeTakeFirstOrThrow());
  await withMeeting(options.workerDb, meetingId, (trx) => trx.updateTable("meetings").set({ state: "running", started_at: SEED_START, ends_at: new Date(SEED_START.getTime() + 600_000), phase: "explore" }).where("id", "=", meetingId).execute());
  const at = SEED_START.toISOString();
  const members = [{ side: "a" as const, displayName: "Test A" }, { side: "b" as const, displayName: "Test B" }];
  await appendSeedEvent(options.workerDb, meetingId, { v: EVENT_VERSION, meetingId, at, type: "meeting.started", startedAt: at, endsAt: new Date(SEED_START.getTime() + 600_000).toISOString(), question: question.question_text, members });
  const turnsBySide = { a: { ids: seeded.a.turnIds, texts: SEED_TURNS_A }, b: { ids: seeded.b.turnIds, texts: SEED_TURNS_B } };
  const counts = { a: 0, b: 0 };
  for (const [index, step] of SEED_STEPS.entries()) {
    const turn = turnsBySide[step.side];
    const k = counts[step.side];
    counts[step.side] += 1;
    const turnId = turn.ids[k] ?? "";
    const quote = turn.texts[k] ?? "";
    const claims = step.claims.map((claim, position) => ({ id: randomUUID(), side: step.side, position: position + 1, text: claim, quote, gloss: `The note says this about the claim: ${claim.toLowerCase()}.`, lang: "en", turnId, verified: true, flagged: false, evidenceValid: true }));
    await appendSeedEvent(options.workerDb, meetingId, { v: EVENT_VERSION, meetingId, at, type: "turn.committed", stepSeq: index + 1, side: step.side, phase: step.phase, text: step.text, claims });
  }
  if (options.end) {
    await withMeeting(options.workerDb, meetingId, (trx) => trx.updateTable("meetings").set({ state: "ended", ended_at: SEED_START, end_reason: "decided" }).where("id", "=", meetingId).execute());
    await appendSeedEvent(options.workerDb, meetingId, { v: EVENT_VERSION, meetingId, at, type: "meeting.ended", reason: "decided", endedAt: at });
  }
  return seeded;
}

// One verified quote a line can cite: the side, the note turn it names, its text and the line's text.
type Citation = { text: string; side: "a" | "b"; turnIndex: number; quote: string };
// The rule-made replies of one ended meeting: each side's brief, each side's judge verdicts, and the first statement of each side.
type ReplyPlan = { brief: Record<"a" | "b", Record<string, unknown>>; judge: Record<"a" | "b", Record<string, unknown>>; firstStatement: Record<"a" | "b", string> };

// The verified claims and approved verified items of one side, as citations, in transcript order and then position order.
function citationsOf(snapshot: BriefSnapshot, side: "a" | "b"): Citation[] {
  const turnIndexOf = (turnId: string): number | undefined => snapshot.sourceTurns.find((turn) => turn.id === turnId)?.turnIndex;
  const fromClaims = snapshot.transcript.flatMap((turn) => turn.claims).filter((claim) => claim.side === side && claim.verified).map((claim) => ({ text: claim.text, side, quote: claim.quote, turnIndex: turnIndexOf(claim.turnId) }));
  const fromItems = snapshot.items.filter((item) => item.side === side && item.verified).map((item) => ({ text: item.claim, side, quote: item.quote, turnIndex: turnIndexOf(item.turnId) }));
  return [...fromClaims, ...fromItems].flatMap((citation) => (citation.turnIndex === undefined ? [] : [{ ...citation, turnIndex: citation.turnIndex }]));
}

// The words each section's lines start with, so no line text repeats inside a brief even when a citation is used twice. The golden
// path matches lines by text: a repeated text would put the one unsupported line's words on a supported line as well.
const SECTION_LEADS = { agree: "On this you agree", clash: "On this you differ", decide_first: "Settle first" } as const;

// One brief line of a section that cites one citation.
function lineOf(citation: Citation, section: keyof typeof SECTION_LEADS): { text: string; quotes: unknown[] } {
  const point = citation.text.charAt(0).toLowerCase() + citation.text.slice(1);
  return { text: `${SECTION_LEADS[section]}: ${point}`, quotes: [{ text: citation.quote, side: citation.side, turn_id: sourceTurnLabel(citation.turnIndex) }] };
}

// The reply for one side's brief: three agree, three clash and three decide-first lines, nine citations in all.
function briefReplyOf(picked: Citation[]): { agree: Array<{ text: string }>; clash: unknown[]; decide_first: unknown[] } {
  return {
    agree: picked.slice(0, 3).map((citation) => lineOf(citation, "agree")),
    clash: picked.slice(3, 6).map((citation) => lineOf(citation, "clash")),
    decide_first: picked.slice(6, 9).map((citation) => lineOf(citation, "decide_first")),
  };
}

// The citations of one side with each text once, repeated until they fill the brief's nine lines; at least three distinct
// texts are needed so that no section cites one twice.
function nineCitations(citations: Citation[]): Citation[] {
  const distinct = citations.filter((citation, index) => citations.findIndex((other) => other.text === citation.text) === index);
  if (distinct.length < 3) throw new ContractError("golden_citations_short", "A side has fewer than three distinct verified claims or items to cite. Check the claims and the card build.", 500);
  return Array.from(Array(LINE_COUNT).keys(), (index) => distinct[index % distinct.length]).filter((citation): citation is Citation => citation !== undefined);
}

// The judge reply for one side: every line supported, except the first agree line of side a, which is the one unsupported line of the run.
function judgeReplyOf(side: "a" | "b"): Record<string, unknown> {
  return { lines: Array.from(Array(LINE_COUNT).keys(), (index) => ({ index, supported: !(side === "a" && index === 0), reason: "The quote carries the point of the line." })) };
}

// The reply plan of one meeting: nine citations per side, or a refusal when a side has fewer than three distinct ones.
function planFor(snapshot: BriefSnapshot): ReplyPlan {
  const brief = { a: briefReplyOf(nineCitations(citationsOf(snapshot, "a"))), b: briefReplyOf(nineCitations(citationsOf(snapshot, "b"))) };
  const first = { a: brief.a.agree[0]?.text ?? "", b: brief.b.agree[0]?.text ?? "" };
  return { brief, judge: { a: judgeReplyOf("a"), b: judgeReplyOf("b") }, firstStatement: first };
}

// The reply the plan gives a brief call: the brief of the side the call writes for, read from the call's system message.
function briefCallReply(args: CompleteArgs, plan: ReplyPlan): Record<string, unknown> {
  const side = /You write for the human on side ([ab])\./.exec(args.messages[0]?.content ?? "")?.[1];
  if (side === "a" || side === "b") return plan.brief[side];
  throw new ContractError("golden_side_unknown", "A brief call does not name its side. Check the brief prompt.", 500);
}

// The reply the plan gives a judge call: the verdicts of the side whose statements the call carries.
function judgeCallReply(args: CompleteArgs, plan: ReplyPlan): Record<string, unknown> {
  const side = (args.messages[1]?.content ?? "").includes(`<statement>${plan.firstStatement.a}</statement>`) ? "a" : "b";
  return plan.judge[side];
}

// The reply the plan gives one call, by call site. Only the two brief call sites are answered here.
function replyFor(args: CompleteArgs, plan: ReplyPlan): Record<string, unknown> {
  if (args.callSite === "brief") return briefCallReply(args, plan);
  if (args.callSite === "brief_support_judge") return judgeCallReply(args, plan);
  throw new ContractError("golden_call_unexpected", `The brief writer answers brief and brief_support_judge calls only, not ${args.callSite}. Check the job.`, 500);
}

// What the recording client needs: the replay client that answers, the reply plan, the folder to write to, and the list of paths written.
type RecordingOptions = { replay: LlmClient; plan: ReplyPlan; fixtureRoot: string; written: string[] };

// A client that writes each request's reply as a fixture, then lets the replay client answer from that fixture (D74).
function recordingClient(options: RecordingOptions): LlmClient {
  return {
    complete: async (args) => {
      const body = chatBodyFor(args, false);
      const folder = join(options.fixtureRoot, args.callSite);
      const path = join(folder, `${requestHash(body)}.json`);
      const recorded = scriptedRecordedCall({ callSite: args.callSite, promptVersion: args.promptVersion, body }, structuredReplyLayout(replyFor(args, options.plan)));
      await mkdir(folder, { recursive: true });
      await writeFile(path, `${JSON.stringify(recorded, null, 2)}\n`);
      options.written.push(path);
      return options.replay.complete(args);
    },
    stream: options.replay.stream,
    image: options.replay.image,
  };
}

// Writes the recorded replies of an ended meeting's two briefs and two judge calls, runs write_briefs on them, and returns the paths written.
export async function writeBriefFixtures(options: { workerUrl: string; meetingId: string; fixtureRoot: string }): Promise<string[]> {
  const db = makeDatabase(options.workerUrl, POOL_SIZE.test);
  try {
    const read = await readBriefSnapshot(db, options.meetingId);
    if (read.kind !== "ready") {
      throw new ContractError("golden_meeting_not_ended", "The golden meeting has not ended. Run the golden path to step 12, then run this command with that meeting id.", 400);
    }
    const plan = planFor(read.snapshot);
    const env = testWorkerEnv("replay", { DATABASE_URL_WORKER: options.workerUrl });
    const now = (): Date => new Date();
    const replay = makeLlmClient({ db, env, now, sleep: () => Promise.resolve(), random: () => 0.5, fixtureRoot: options.fixtureRoot });
    const written: string[] = [];
    const llm = recordingClient({ replay, plan, fixtureRoot: options.fixtureRoot, written });
    const context: JobContext = { db, env, now, enqueue: () => Promise.resolve(), llm, log: pino({ level: "silent" }) };
    await writeBriefsTask({ meetingId: options.meetingId }, context);
    return written;
  } finally {
    await db.destroy();
  }
}

// The command entry: "meeting <id>" writes the meeting's brief fixtures into the repository folder, one path per line.
async function main(argv: readonly string[]): Promise<string[]> {
  const meetingId = argv[1];
  if (argv[0] !== "meeting" || meetingId === undefined) throw new ContractError("golden_command_unknown", "Use the word meeting and a meeting id.", 400);
  return writeBriefFixtures({ workerUrl: process.env.DATABASE_URL_WORKER ?? "", meetingId, fixtureRoot: FIXTURE_DIR });
}

// Runs the command when this file is the process entry; importing it for tests starts nothing.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (paths) => {
      for (const path of paths) process.stdout.write(`${path}\n`);
    },
    (error: unknown) => {
      const line = error instanceof ContractError ? `${error.code}: ${error.message}` : `golden_failed: ${String(error)}`;
      process.stderr.write(`${line}\n`);
      process.exitCode = 1;
    },
  );
}
