import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Transaction } from "kysely";
import { QUIZ_BANK_VERSION, sampleQuiz, QuizRequestResponse, ContractError, Uuid, routes } from "@meet-first/contracts";
import { parseDatabaseError, withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";

// The card states a quiz may start from: built and not thin, approved or not (approving the card and taking the quiz may come in either order).
const QUIZ_READY_STATES = ["ready", "approved"] as const;
// The :id of POST /api/cards/:id/quiz: a uuid, or the card cannot exist.
const CardRouteParams = z.object({ id: Uuid });

// Refuses the quiz when the card is missing, still building, failed, or thin (a thin card skips the quiz).
export function assertCardCanQuiz(card: { state: string; thin: boolean } | undefined): asserts card is { state: "ready" | "approved"; thin: false } {
  if (card === undefined) {
    throw new ContractError("not_found", "This no longer exists or is not yours.", 404);
  }
  if (card.thin) {
    throw new ContractError("card_thin", "This card has fewer than 6 verified items, so the quiz is skipped. You can still meet.", 409);
  }
  if (!QUIZ_READY_STATES.some((state) => state === card.state)) {
    throw new ContractError("card_not_ready", "The card is still being built or failed. Wait for it to be ready, then try again.", 409);
  }
}

// Inserts the quiz row and its ten items in the given transaction and returns the quiz id.
export async function insertQuiz(trx: Transaction<Database>, card: { id: string; personId: string }): Promise<string> {
  const questionIds = sampleQuiz(card.id);
  const quiz = await trx
    .insertInto("quizzes")
    .values({ card_id: card.id, person_id: card.personId, bank_version: QUIZ_BANK_VERSION, seed: card.id, state: "answering" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("quiz_items")
    .values(
      questionIds.map((questionId, index) => ({
        quiz_id: quiz.id,
        person_id: card.personId,
        position: index + 1,
        bank_version: QUIZ_BANK_VERSION,
        question_id: questionId,
        flipped: randomInt(2) === 1,
      })),
    )
    .execute();
  return quiz.id;
}

// Registers POST /api/cards/:id/quiz: 202 with the quiz id; 404 not_found; 409 card_thin, card_not_ready, quiz_exists.
export function registerCreateQuiz(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.cards.requestQuiz.path, async (request, reply) => {
    const personId = requirePerson(request);
    const parsedCardId = CardRouteParams.safeParse(request.params);
    if (!parsedCardId.success) {
      throw new ContractError("not_found", "This no longer exists or is not yours.", 404);
    }
    const cardId = parsedCardId.data.id;
    const quizId = await withPerson(deps.db, personId, async (trx) => {
      const card = await trx.selectFrom("cards").select(["id", "person_id", "state", "thin"]).where("id", "=", cardId).executeTakeFirst();
      assertCardCanQuiz(card);
      try {
        return await insertQuiz(trx, { id: card.id, personId });
      } catch (error) {
        if (parseDatabaseError(error)?.code === "duplicate") {
          throw new ContractError("quiz_exists", "This card already has a quiz. Open it instead of starting another.", 409);
        }
        throw error;
      }
    });
    // The job is queued after the rows above have committed, so the job never reads a quiz that is not visible yet.
    const payload = { quizId, personId };
    try {
      await deps.enqueue("answer_quiz", payload);
    } catch (error) {
      await withPerson(deps.db, personId, (trx) => trx.deleteFrom("quizzes").where("id", "=", quizId).execute());
      throw error;
    }
    return reply.code(202).send(QuizRequestResponse.parse({ quizId }));
  });
}
