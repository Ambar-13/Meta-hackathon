import type { Transaction } from "kysely";
import { QuestionCheckOutput, ROMANCE_NOT_OPEN_REASON, toStrictJsonSchema } from "@meet-first/contracts";
import { withMeeting, type Database } from "@meet-first/db";
import { DEFAULT_CHARS_PER_TOKEN, LimiterBusy, reenqueueAfterLimiter, type ChatMessage, type CompleteArgs } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import type { JobContext, JobTask } from "../job-context.js";
import { quizMisses } from "../quizzes/index.js";
import { startIfReady } from "./commit-turn.js";
import { buildFrozenPrefix, type LoadedPrompt, type MeetingPrompts, type PrefixItem } from "./prompt-builder.js";
import { loadMeetingPrompts } from "./step-job.js";

// The check_question job: the free-text check when the question is unchecked, then both frozen prefixes (R10.5, D41).
export const runCheckQuestion: JobTask<"check_question"> = async (payload, context) => {
  const meetingId = payload.meetingId;
  const prompts = loadMeetingPrompts();
  const meeting = await withMeeting(context.db, meetingId, (trx) => trx.selectFrom("meetings")
    .select(["state", "question_text", "question_checked_at", "question_rejected_reason"]).where("id", "=", meetingId).executeTakeFirst());
  if (meeting === undefined || (meeting.state !== "ready" && meeting.state !== "queued") || meeting.question_rejected_reason !== null) return;
  const verdict = meeting.question_checked_at === null
    ? await checkQuestion(context, { meetingId, checkPrompt: loadCheckPrompt(), questionText: meeting.question_text })
    : undefined;
  if (verdict === "limited") return;
  const started = await withMeeting(context.db, meetingId, (trx) => applyVerdict(trx, { context, meetingId, prompts }, verdict));
  if (started === "running") await context.enqueue("meeting_step", { meetingId, stepSeq: 1 });
};

// The question-check prompt as the job reads it: its version and its text.
function loadCheckPrompt(): LoadedPrompt {
  const prompt = readPrompt("question-check");
  return { text: prompt.text, version: prompt.version };
}

// One question to check: the meeting, the prompt and the question text.
type QuestionRequest = { meetingId: string; checkPrompt: LoadedPrompt; questionText: string };
// What the writes after the verdict need: the job context, the meeting and the prompts.
type VerdictScope = { context: JobContext; meetingId: string; prompts: MeetingPrompts };

// The messages of the question check: the question-check prompt as the system message, the question inside meeting_question tags as the user message (R10.5, R7.3).
export function questionCheckMessages(promptText: string, questionText: string): ChatMessage[] {
  return [
    { role: "system", content: promptText },
    { role: "user", content: "<meeting_question>\n" + questionText + "\n</meeting_question>" },
  ];
}

// The LlmClient arguments of the question check; the fixture command calls the same function (D74).
export function questionCheckCallArgs(input: { meetingId: string; promptVersion: string; messages: ChatMessage[] }): CompleteArgs {
  return {
    callSite: "question_check",
    promptVersion: input.promptVersion,
    messages: input.messages,
    schema: toStrictJsonSchema(QuestionCheckOutput, "question-check"),
    ledger: { personId: null, meetingId: input.meetingId },
  };
}

// Builds and stores the frozen prefix of each side that has none, inside the caller's transaction (D41, invariant 17).
export async function storeFrozenPrefixes(trx: Transaction<Database>, meetingId: string, prompts: MeetingPrompts): Promise<number> {
  const question = await trx.selectFrom("meetings").select(["question_text", "question_kind"]).where("id", "=", meetingId).executeTakeFirstOrThrow();
  const members = await trx.selectFrom("meeting_members as mm").innerJoin("people as p", "p.id", "mm.person_id")
    .select(["mm.side", "mm.person_id", "mm.card_id", "mm.frozen_prefix", "mm.public_only", "p.display_name"]).where("mm.meeting_id", "=", meetingId).orderBy("mm.side").execute();
  let written = 0;
  for (const member of members) {
    if (member.frozen_prefix !== null) continue;
    const other = members.find((candidate) => candidate.side !== member.side);
    if (other === undefined) continue;
    // A listed persona met through the directory speaks only from the items its owner marked public (as-built item 49).
    const items = await trx.selectFrom("card_items as ci").innerJoin("turns as t", "t.id", "ci.turn_id")
      .select(["ci.position", "ci.kind", "ci.claim", "ci.lang", "ci.gloss", "ci.quote", "t.turn_index"])
      .where("ci.card_id", "=", member.card_id).where("ci.approved", "=", true)
      .$if(member.public_only, (query) => query.where("ci.is_public", "=", true))
      .orderBy("ci.position").execute();
    const misses = await quizMisses(trx, member.card_id);
    const prefix = buildFrozenPrefix({
      texts: { moderator: prompts.moderator.text, speech: prompts.speech.text, untrustedRules: prompts.untrustedRules.text },
      question: question.question_text, questionKind: question.question_kind, side: member.side, ownName: member.display_name, otherName: other.display_name, items: items.map(toPrefixItem), misses,
    });
    const estimate = Math.ceil(prefix.length / DEFAULT_CHARS_PER_TOKEN);
    await trx.updateTable("meeting_members").set({ frozen_prefix: prefix, frozen_prefix_tokens: estimate })
      .where("meeting_id", "=", meetingId).where("side", "=", member.side).where("frozen_prefix", "is", null).execute();
    written += 1;
  }
  return written;
}

// The question check's model call: one minimal call, re-queued when the limiter is full. Returns the verdict or "limited".
async function checkQuestion(context: JobContext, request: QuestionRequest): Promise<QuestionCheckOutput | "limited"> {
  try {
    const result = await context.llm.complete(questionCheckCallArgs({ meetingId: request.meetingId, promptVersion: request.checkPrompt.version, messages: questionCheckMessages(request.checkPrompt.text, request.questionText) }));
    return QuestionCheckOutput.parse(result.parsed);
  } catch (error) {
    if (!(error instanceof LimiterBusy)) throw error;
    await reenqueueAfterLimiter(context, "check_question", { meetingId: request.meetingId });
    return "limited";
  }
}

// One approved item as the prefix shows it: the turn index is renamed to the prefix's own name.
function toPrefixItem(item: { position: number; kind: string; claim: string; lang: string; gloss: string; quote: string; turn_index: number }): PrefixItem {
  return { position: item.position, kind: item.kind, claim: item.claim, lang: item.lang, gloss: item.gloss, quote: item.quote, turnIndex: item.turn_index };
}

// The writes after the verdict, in one transaction: the verdict, both prefixes, then the start if both go-aheads are in.
async function applyVerdict(trx: Transaction<Database>, scope: VerdictScope, verdict: QuestionCheckOutput | undefined): Promise<"running" | "queued" | "not_ready" | "refused"> {
  const { context, meetingId } = scope;
  await trx.selectFrom("meetings").select("id").where("id", "=", meetingId).forUpdate().executeTakeFirst();
  if (verdict !== undefined && !verdict.allowed) {
    await trx.updateTable("meetings").set({ question_rejected_reason: verdict.reason }).where("id", "=", meetingId).execute();
    return "refused";
  }
  // A question with any romantic part, to a listed persona whose owner has not switched on dating questions, is refused, whatever kind
  // the check gave it (as-built items 54 and 55).
  if (verdict !== undefined && (verdict.romantic || verdict.kind === "romance")) {
    const meeting = await trx.selectFrom("meetings").select("romance_allowed").where("id", "=", meetingId).executeTakeFirstOrThrow();
    if (!meeting.romance_allowed) {
      await trx.updateTable("meetings").set({ question_rejected_reason: ROMANCE_NOT_OPEN_REASON }).where("id", "=", meetingId).execute();
      return "refused";
    }
  }
  if (verdict !== undefined) {
    // The kind is written before the prefixes below are built, so both personas read the kind the check gave.
    await trx.updateTable("meetings").set({ question_checked_at: context.now(), question_kind: verdict.kind }).where("id", "=", meetingId).where("question_checked_at", "is", null).execute();
  }
  await storeFrozenPrefixes(trx, meetingId, scope.prompts);
  return startIfReady(trx, { meetingId, now: context.now(), maxRunning: context.env.MAX_CONCURRENT_MEETINGS });
}
