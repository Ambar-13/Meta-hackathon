import type { Transaction } from "kysely";
import { ContractError, QUIZ_ITEMS, QuizCalibrationRaw, QuizJudgeOutput, QuizJudgeRaw, type QuizCalibrationRun } from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import { LimiterBusy, reenqueueAfterLimiter } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import type { JobContext, JobTask } from "../job-context.js";
import { markQuizFailed } from "./answer-quiz-job.js";
import { calibrationEntryFor, checkCalibrationRun, type CalibrationCallResult } from "./calibration.js";
import { buildJudgeCall, orderForJudge, type JudgeInput, type QuizPrompt } from "./quiz-requests.js";

// One quiz item as the judge job reads it (D30).
export type JudgeItem = { position: number; questionText: string; personaAnswer: string; humanAnswer: string; flipped: boolean };
// One item's verdict with its raw record (R4.5).
export type JudgeVerdict = { position: number; agree: boolean; reason: string; judgeRaw: QuizJudgeRaw };
// The result of judging one quiz: verdicts with the calibration record, or a stop because a judge reply could not be read (D30, R4.4).
export type JudgeOutcome =
  | { kind: "judged"; judgeRuns: 1 | 2; isReliable: boolean; verdicts: JudgeVerdict[]; calibration: QuizCalibrationRun[] }
  | { kind: "unreadable"; calibration: QuizCalibrationRun[] };
// What every judge call of one quiz shares: the person, the quiz and the prompt.
export type JudgeBase = { personId: string; quizId: string; prompt: QuizPrompt };
// What the job reads before it calls the model: skip the quiz, stop it as broken, or judge these items.
type JudgePlan = { kind: "skip" } | { kind: "broken" } | { kind: "judge"; items: JudgeItem[] };

// Runs one judge call, holding no transaction open. The output is null when the reply does not parse as QuizJudgeOutput (D30).
export async function judgeOnce(context: JobContext, base: JudgeBase, input: JudgeInput): Promise<CalibrationCallResult> {
  const reply = await context.llm.complete({ ...buildJudgeCall(base.prompt, input), ledger: { personId: base.personId, meetingId: null } });
  const parsed = QuizJudgeOutput.safeParse(reply.parsed);
  return { output: parsed.success ? parsed.data : null, ledgerId: reply.ledgerId };
}

// Runs the two calibration pairs of one run: the identical pair must agree and the contradicting pair must not (D30, R4.6).
async function calibrate(context: JobContext, base: JudgeBase, run: 1 | 2): Promise<QuizCalibrationRun> {
  const entry = calibrationEntryFor(base.quizId, run);
  const identical = await judgeOnce(context, base, { questionText: entry.questionText, answer1: entry.answerA, answer2: entry.answerA });
  const contradicting = await judgeOnce(context, base, { questionText: entry.questionText, answer1: entry.answerA, answer2: entry.answerB });
  return checkCalibrationRun({ run, entryIndex: entry.index, results: [identical, contradicting] });
}

// Judges the ten items in position order for one run. Returns null at the first unreadable reply, so no further call is made in that run.
async function judgeItems(context: JobContext, base: JudgeBase, args: { items: readonly JudgeItem[]; run: 1 | 2 }): Promise<JudgeVerdict[] | null> {
  const verdicts: JudgeVerdict[] = [];
  for (const item of args.items) {
    const order = orderForJudge(item, args.run);
    const result = await judgeOnce(context, base, { questionText: item.questionText, answer1: order.answer1, answer2: order.answer2 });
    if (result.output === null) return null;
    verdicts.push({
      position: item.position,
      agree: result.output.agree,
      reason: result.output.reason,
      judgeRaw: { run: args.run, isHumanFirst: order.isHumanFirst, output: result.output, ledgerId: result.ledgerId },
    });
  }
  return verdicts;
}

// Judges the ten items: calibration first, the items when it passes, and one rerun with the other order and the next calibration entry when it does not (D30, R4.4, R4.6).
export async function runJudge(context: JobContext, base: JudgeBase, items: readonly JudgeItem[]): Promise<JudgeOutcome> {
  const run1 = await calibrate(context, base, 1);
  if (run1.isPassed) {
    const verdicts1 = await judgeItems(context, base, { items, run: 1 });
    if (verdicts1 !== null) {
      return { kind: "judged", judgeRuns: 1, isReliable: true, verdicts: verdicts1, calibration: [run1] };
    }
  }
  const run2 = await calibrate(context, base, 2);
  const verdicts2 = await judgeItems(context, base, { items, run: 2 });
  if (verdicts2 === null) {
    return { kind: "unreadable", calibration: [run1, run2] };
  }
  return { kind: "judged", judgeRuns: 2, isReliable: run2.isPassed, verdicts: verdicts2, calibration: [run1, run2] };
}

// Reads the quiz and its ten items in one committed read, and says whether the job should judge them.
async function readJudgePlan(trx: Transaction<Database>, quizId: string): Promise<JudgePlan> {
  const quiz = await trx.selectFrom("quizzes").select(["state"]).where("id", "=", quizId).executeTakeFirst();
  if (quiz === undefined || quiz.state !== "judging") return { kind: "skip" };
  const rows = await trx
    .selectFrom("quiz_items")
    .innerJoin("quiz_bank", (join) =>
      join.onRef("quiz_bank.bank_version", "=", "quiz_items.bank_version").onRef("quiz_bank.question_id", "=", "quiz_items.question_id"),
    )
    .select(["quiz_items.position", "quiz_items.flipped", "quiz_items.persona_answer", "quiz_items.human_answer", "quiz_bank.text"])
    .where("quiz_items.quiz_id", "=", quizId)
    .orderBy("quiz_items.position", "asc")
    .execute();
  if (rows.length !== QUIZ_ITEMS) return { kind: "broken" };
  const items: JudgeItem[] = [];
  for (const row of rows) {
    if (row.persona_answer === null || row.human_answer === null) return { kind: "broken" };
    items.push({ position: row.position, questionText: row.text, personaAnswer: row.persona_answer, humanAnswer: row.human_answer, flipped: row.flipped });
  }
  return { kind: "judge", items };
}

// Stores the verdicts and the count in one transaction. Only a quiz still being judged changes, and only once.
async function storeJudgement(trx: Transaction<Database>, args: { quizId: string; outcome: Extract<JudgeOutcome, { kind: "judged" }>; judgedAt: Date }): Promise<void> {
  const { quizId, outcome, judgedAt } = args;
  const matched = outcome.verdicts.filter((verdict) => verdict.agree).length;
  const calibrationRaw = QuizCalibrationRaw.parse(outcome.calibration);
  const updated = await trx
    .updateTable("quizzes")
    .set({
      state: "judged",
      matched,
      reliable: outcome.isReliable,
      judge_runs: outcome.judgeRuns,
      calibration_raw: JSON.stringify(calibrationRaw),
      judged_at: judgedAt,
    })
    .where("id", "=", quizId)
    .where("state", "=", "judging")
    .returning("id")
    .executeTakeFirst();
  if (updated === undefined) return;
  for (const verdict of outcome.verdicts) {
    await trx
      .updateTable("quiz_items")
      .set({ agree: verdict.agree, judge_reason: verdict.reason, judge_raw: JSON.stringify(QuizJudgeRaw.parse(verdict.judgeRaw)) })
      .where("quiz_id", "=", quizId)
      .where("position", "=", verdict.position)
      .execute();
  }
}

// The judge_quiz job (IMPLEMENTATION.md 2.3): judges the ten items blind, then stores the verdicts and the count together.
export const judgeQuizTask: JobTask<"judge_quiz"> = async (payload, context) => {
  const { quizId, personId } = payload;
  const plan = await withPerson(context.db, personId, (trx) => readJudgePlan(trx, quizId));
  if (plan.kind === "skip") return;
  if (plan.kind === "broken") {
    await markQuizFailed(context, { personId, quizId, fromState: "judging" }, "quiz_items_incomplete");
    return;
  }
  const prompt: QuizPrompt = readPrompt("quiz-judge");
  let outcome: JudgeOutcome;
  try {
    outcome = await runJudge(context, { personId, quizId, prompt }, plan.items);
  } catch (error) {
    if (error instanceof LimiterBusy) {
      await reenqueueAfterLimiter(context, "judge_quiz", { quizId, personId });
      return;
    }
    await markQuizFailed(context, { personId, quizId, fromState: "judging" }, error instanceof ContractError ? error.code : "quiz_job_error");
    return;
  }
  if (outcome.kind === "unreadable") {
    await markQuizFailed(context, { personId, quizId, fromState: "judging" }, "judge_output_unreadable");
    return;
  }
  await withPerson(context.db, personId, (trx) => storeJudgement(trx, { quizId, outcome, judgedAt: context.now() }));
};
