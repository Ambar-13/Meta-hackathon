import type { Transaction } from "kysely";
import { ContractError, QuizPersonaAnswerOutput } from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import { LimiterBusy, reenqueueAfterLimiter } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import type { JobContext, JobTask } from "../job-context.js";
import { buildPersonaAnswerCall, QUIZ_STOP_SENTENCES, type PersonaCardItem, type QuizPrompt, type QuizStopCode } from "./quiz-requests.js";

// One item still waiting for its persona answer: its position and the bank question text.
type PendingItem = { position: number; text: string };
// What the job reads before it calls the model: skip the quiz, or answer the pending items from these card items.
type AnswerPlan = { kind: "skip" } | { kind: "answer"; cardItems: PersonaCardItem[]; pending: PendingItem[] };

// The card items the persona may use: the verified items of a ready card, or the approved and verified items of an approved card, in position order (R4.1).
export async function readPersonaCardItems(trx: Transaction<Database>, cardId: string): Promise<PersonaCardItem[]> {
  const card = await trx.selectFrom("cards").select(["state"]).where("id", "=", cardId).executeTakeFirst();
  if (card === undefined) return [];
  let query = trx
    .selectFrom("card_items")
    .select(["position", "kind", "claim", "gloss", "quote"])
    .where("card_id", "=", cardId)
    .where("verified", "=", true);
  if (card.state === "approved") {
    query = query.where("approved", "=", true);
  }
  return query.orderBy("position", "asc").execute();
}

// Marks a quiz failed from the state its job was working in and logs the stop code, so the screen stops waiting (fail closed).
export async function markQuizFailed(
  context: JobContext,
  target: { personId: string; quizId: string; fromState: "answering" | "judging" },
  code: string,
): Promise<void> {
  await withPerson(context.db, target.personId, (trx) =>
    trx.updateTable("quizzes").set({ state: "failed" }).where("id", "=", target.quizId).where("state", "=", target.fromState).execute(),
  );
  const sentence = code in QUIZ_STOP_SENTENCES ? QUIZ_STOP_SENTENCES[code as QuizStopCode] : QUIZ_STOP_SENTENCES.quiz_job_error;
  context.log.warn({ quizId: target.quizId, code }, sentence);
}

// Reads what the job needs in one committed read: the quiz state, the card items the persona may use, and the items still unanswered.
async function readAnswerPlan(trx: Transaction<Database>, quizId: string): Promise<AnswerPlan> {
  const quiz = await trx.selectFrom("quizzes").select(["card_id", "state"]).where("id", "=", quizId).executeTakeFirst();
  if (quiz === undefined || quiz.state !== "answering") return { kind: "skip" };
  const pending = await trx
    .selectFrom("quiz_items")
    .innerJoin("quiz_bank", (join) =>
      join.onRef("quiz_bank.bank_version", "=", "quiz_items.bank_version").onRef("quiz_bank.question_id", "=", "quiz_items.question_id"),
    )
    .select(["quiz_items.position", "quiz_bank.text"])
    .where("quiz_items.quiz_id", "=", quizId)
    .where("quiz_items.persona_answer", "is", null)
    .orderBy("quiz_items.position", "asc")
    .execute();
  return { kind: "answer", cardItems: await readPersonaCardItems(trx, quiz.card_id), pending };
}

// One model call for one item. The answer is stored in its own short transaction the moment the call returns, so a later run skips it.
async function answerOneItem(
  context: JobContext,
  args: { personId: string; quizId: string; prompt: QuizPrompt; cardItems: PersonaCardItem[]; item: PendingItem },
): Promise<void> {
  const call = buildPersonaAnswerCall(args.prompt, args.cardItems, args.item.text);
  const reply = await context.llm.complete({ ...call, ledger: { personId: args.personId, meetingId: null } });
  const parsed = QuizPersonaAnswerOutput.safeParse(reply.parsed);
  if (!parsed.success) {
    throw new ContractError("persona_answer_unreadable", QUIZ_STOP_SENTENCES.persona_answer_unreadable, 500);
  }
  await withPerson(context.db, args.personId, (trx) =>
    trx
      .updateTable("quiz_items")
      .set({ persona_answer: parsed.data.answer })
      .where("quiz_id", "=", args.quizId)
      .where("position", "=", args.item.position)
      .where("persona_answer", "is", null)
      .execute(),
  );
}

// Opens the quiz for the human once every item has a persona answer. Until then the form stays locked (ARCHITECTURE.md section 5 step 9, R4.2).
async function openForHuman(trx: Transaction<Database>, quizId: string): Promise<void> {
  const missing = await trx.selectFrom("quiz_items").select(["position"]).where("quiz_id", "=", quizId).where("persona_answer", "is", null).execute();
  if (missing.length === 0) {
    await trx.updateTable("quizzes").set({ state: "waiting_human" }).where("id", "=", quizId).where("state", "=", "answering").execute();
  }
}

// The answer_quiz job (IMPLEMENTATION.md 2.3): answers every item that has no persona answer yet, then opens the quiz for the human.
export const answerQuizTask: JobTask<"answer_quiz"> = async (payload, context) => {
  const { quizId, personId } = payload;
  const plan = await withPerson(context.db, personId, (trx) => readAnswerPlan(trx, quizId));
  if (plan.kind === "skip") return;
  if (plan.cardItems.length === 0) {
    await markQuizFailed(context, { personId, quizId, fromState: "answering" }, "persona_card_empty");
    return;
  }
  const prompt: QuizPrompt = readPrompt("quiz-persona-answer");
  try {
    for (const item of plan.pending) {
      await answerOneItem(context, { personId, quizId, prompt, cardItems: plan.cardItems, item });
    }
  } catch (error) {
    if (error instanceof LimiterBusy) {
      await reenqueueAfterLimiter(context, "answer_quiz", { quizId, personId });
      return;
    }
    await markQuizFailed(context, { personId, quizId, fromState: "answering" }, error instanceof ContractError ? error.code : "quiz_job_error");
    return;
  }
  await withPerson(context.db, personId, (trx) => openForHuman(trx, quizId));
};
