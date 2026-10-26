import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Transaction } from "kysely";
import { QuizAnswers, QuizAnswersResponse, QUIZ_ITEMS, ContractError, Uuid, routes } from "@meet-first/contracts";
import { parseDatabaseError, withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";

// The :id of POST /api/quizzes/:id/answers: a uuid, or the quiz cannot exist.
const QuizRouteParams = z.object({ id: Uuid });

// Refuses answers unless the persona has finished answering and the human has not yet answered (R4.2, D29).
export function assertQuizWaitingHuman(quiz: { state: string } | undefined): void {
  if (quiz === undefined) {
    throw new ContractError("not_found", "This no longer exists or is not yours.", 404);
  }
  if (quiz.state !== "waiting_human") {
    throw new ContractError("quiz_not_waiting", "This quiz is not ready for your answers, or you already sent them. Reload to see where it stands.", 409);
  }
}

// Writes one human answer to its position. A missing persona answer is refused with its own code (D29, invariant 7).
async function writeOneAnswer(trx: Transaction<Database>, args: { quizId: string; position: number; text: string; now: Date }): Promise<number> {
  try {
    const result = await trx
      .updateTable("quiz_items")
      .set({ human_answer: args.text, answered_at: args.now })
      .where("quiz_id", "=", args.quizId)
      .where("position", "=", args.position)
      .where("human_answer", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  } catch (error) {
    if (parseDatabaseError(error)?.code === "persona_answer_missing") {
      throw new ContractError("persona_answer_missing", "The persona has not answered this question yet. Wait a moment and reload.", 409);
    }
    throw error;
  }
}

// Writes the ten answers and moves the quiz to judging in the given transaction. The quiz row is claimed first, so a second send waits on it.
export async function storeHumanAnswers(trx: Transaction<Database>, args: { quizId: string; answers: QuizAnswers["answers"]; now: Date }): Promise<"judging"> {
  const { quizId, answers, now } = args;
  const claimed = await trx
    .updateTable("quizzes")
    .set({ state: "judging" })
    .where("id", "=", quizId)
    .where("state", "=", "waiting_human")
    .executeTakeFirst();
  if (Number(claimed.numUpdatedRows) !== 1) {
    throw new ContractError("quiz_not_waiting", "This quiz is not ready for your answers, or you already sent them. Reload to see where it stands.", 409);
  }
  let updatedRows = 0;
  for (const answer of answers) {
    updatedRows += await writeOneAnswer(trx, { quizId, position: answer.position, text: answer.text, now });
  }
  if (updatedRows !== QUIZ_ITEMS) {
    throw new ContractError("quiz_answers_incomplete", "All 10 answers are needed and each position once. Check the form and send again.", 409);
  }
  return "judging";
}

// Registers POST /api/quizzes/:id/answers: 202 with the new state; 400 payload_invalid; 404 not_found; 409 quiz_not_waiting, quiz_answers_incomplete.
export function registerSubmitAnswers(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.cards.answerQuiz.path, async (request, reply) => {
    const personId = requirePerson(request);
    const parsedQuizId = QuizRouteParams.safeParse(request.params);
    if (!parsedQuizId.success) {
      throw new ContractError("not_found", "This no longer exists or is not yours.", 404);
    }
    const quizId = parsedQuizId.data.id;
    const body = QuizAnswers.safeParse(request.body);
    if (!body.success) {
      throw new ContractError("payload_invalid", "The request body did not match the expected shape. Reload and try again.", 400);
    }
    await withPerson(deps.db, personId, async (trx) => {
      const quiz = await trx.selectFrom("quizzes").select(["state"]).where("id", "=", quizId).executeTakeFirst();
      assertQuizWaitingHuman(quiz);
      await storeHumanAnswers(trx, { quizId, answers: body.data.answers, now: deps.now() });
    });
    // The job is queued after the answers have committed; if the queue refuses, the answers are cleared so they can be sent again.
    const payload = { quizId, personId };
    try {
      await deps.enqueue("judge_quiz", payload);
    } catch (error) {
      await withPerson(deps.db, personId, async (trx) => {
        await trx.updateTable("quiz_items").set({ human_answer: null, answered_at: null }).where("quiz_id", "=", quizId).execute();
        await trx.updateTable("quizzes").set({ state: "waiting_human" }).where("id", "=", quizId).where("state", "=", "judging").execute();
      });
      throw error;
    }
    return reply.code(202).send(QuizAnswersResponse.parse({ state: "judging" }));
  });
}
