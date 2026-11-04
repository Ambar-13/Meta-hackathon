import { z } from "zod";
import { Uuid } from "../primitives.js";

// Most characters one person may answer a quiz question with.
export const QUIZ_ANSWER_MAX_CHARS = 200;
// Questions in every quiz.
export const QUIZ_ITEMS = 10;
// Where a quiz is in its life, from answering to judged or failed.
export const QuizState = z.enum(["answering", "waiting_human", "judging", "judged", "failed"]);
export type QuizState = z.infer<typeof QuizState>;
// One question of a quiz as the browser sees it. The persona answer stays hidden until the human answers.
export const QuizItemView = z.object({
  position: z.number().int().min(1).max(QUIZ_ITEMS),
  questionId: z.number().int().min(1).max(30),
  questionText: z.string(),
  personaAnswer: z.string().optional(),
  humanAnswer: z.string().optional(),
  agree: z.boolean().optional(),
});
export type QuizItemView = z.infer<typeof QuizItemView>;
// What GET /api/quizzes/:id returns. Copy always reads "matched n of 10", never a percentage.
export const QuizView = z.object({
  id: Uuid,
  state: QuizState,
  items: z.array(QuizItemView).length(QUIZ_ITEMS),
  matched: z.number().int().min(0).max(QUIZ_ITEMS).optional(),
  reliable: z.boolean().optional(),
  copy: z.string(),
});
export type QuizView = z.infer<typeof QuizView>;
// The body of POST /api/quizzes/:id/answers: ten human answers, one per position.
export const QuizAnswers = z.object({
  answers: z
    .array(
      z.object({
        position: z.number().int().min(1).max(QUIZ_ITEMS),
        text: z.string().trim().min(1).max(QUIZ_ANSWER_MAX_CHARS),
      }),
    )
    .length(QUIZ_ITEMS),
});
export type QuizAnswers = z.infer<typeof QuizAnswers>;
// What POST /api/cards/:id/quiz returns: the id of the quiz that is being answered.
export const QuizRequestResponse = z.object({ quizId: Uuid });
export type QuizRequestResponse = z.infer<typeof QuizRequestResponse>;
// What POST /api/quizzes/:id/answers returns: the state the quiz moved to.
export const QuizAnswersResponse = z.object({ state: QuizState });
export type QuizAnswersResponse = z.infer<typeof QuizAnswersResponse>;
// The count line of a quiz. A false reliable flag adds the second sentence.
export const quizCopy = (matched: number, isReliable: boolean): string =>
  isReliable
    ? `matched ${String(matched)} of 10`
    : `matched ${String(matched)} of 10. The judge failed its own check twice, so treat this count as rough.`;
// What the persona answer call returns: one short answer (quiz-persona-answer prompt).
export const QuizPersonaAnswerOutput = z.object({
  answer: z.string().min(1).max(QUIZ_ANSWER_MAX_CHARS),
});
export type QuizPersonaAnswerOutput = z.infer<typeof QuizPersonaAnswerOutput>;
// What the blind judge returns: whether the two answers agree and why.
export const QuizJudgeOutput = z.object({ agree: z.boolean(), reason: z.string().min(1).max(300) });
export type QuizJudgeOutput = z.infer<typeof QuizJudgeOutput>;
// One item's raw judge record, kept in quiz_items.judge_raw: the run, the order the judge saw, its parsed output and the ledger row of the call.
export const QuizJudgeRaw = z.object({
  run: z.union([z.literal(1), z.literal(2)]),
  isHumanFirst: z.boolean(),
  output: QuizJudgeOutput,
  ledgerId: Uuid,
});
export type QuizJudgeRaw = z.infer<typeof QuizJudgeRaw>;
// One calibration run, kept in quizzes.calibration_raw: the probe used, both pair results and whether the run passed.
export const QuizCalibrationRun = z.object({
  run: z.union([z.literal(1), z.literal(2)]),
  entryIndex: z.number().int().min(0).max(7),
  isPassed: z.boolean(),
  pairs: z
    .array(
      z.object({
        pair: z.enum(["identical", "contradicting"]),
        shouldAgree: z.boolean(),
        output: QuizJudgeOutput.nullable(),
        isPassed: z.boolean(),
        ledgerId: Uuid,
      }),
    )
    .length(2),
});
export type QuizCalibrationRun = z.infer<typeof QuizCalibrationRun>;
// The calibration record of one quiz: one run, or two when the first failed.
export const QuizCalibrationRaw = z.array(QuizCalibrationRun).min(1).max(2);
export type QuizCalibrationRaw = z.infer<typeof QuizCalibrationRaw>;
