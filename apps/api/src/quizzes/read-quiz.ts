import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  QuizView,
  quizCopy,
  type QuizItemView,
  ContractError,
  Uuid,
  routes,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";

// The :id of GET /api/quizzes/:id: a uuid, or the quiz cannot exist.
const QuizRouteParams = z.object({ id: Uuid });

// One item as the read query returns it: the position, the bank question and both answers with the
// judge's verdict.
type ItemRow = {
  position: number;
  question_id: number;
  text: string;
  persona_answer: string | null;
  human_answer: string | null;
  agree: boolean | null;
};

// Shapes one item for the screen. The persona answer is left out until the human answer exists, so
// nobody can peek.
export function toQuizItemView(row: ItemRow): QuizItemView {
  const answers =
    row.human_answer === null || row.persona_answer === null
      ? {}
      : { personaAnswer: row.persona_answer, humanAnswer: row.human_answer };
  return {
    position: row.position,
    questionId: row.question_id,
    questionText: row.text,
    ...answers,
    ...(row.agree === null ? {} : { agree: row.agree }),
  };
}

// The copy for the whole quiz: "matched n of 10" once judged, an empty string before that; the
// screen owns the waiting copy.
export function quizViewCopy(quiz: {
  state: string;
  matched: number | null;
  reliable: boolean | null;
}): string {
  return quiz.state === "judged" && quiz.matched !== null
    ? quizCopy(quiz.matched, quiz.reliable !== false)
    : "";
}

// Registers GET /api/quizzes/:id: 200 with the quiz view; 404 not_found.
export function registerReadQuiz(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.cards.readQuiz.path, async (request, reply) => {
    const personId = requirePerson(request);
    const parsedQuizId = QuizRouteParams.safeParse(request.params);
    if (!parsedQuizId.success) {
      throw new ContractError("not_found", "This no longer exists or is not yours.", 404);
    }
    const quizId = parsedQuizId.data.id;
    const view = await withPerson(deps.db, personId, async (trx) => {
      const quiz = await trx
        .selectFrom("quizzes")
        .select(["id", "state", "matched", "reliable"])
        .where("id", "=", quizId)
        .executeTakeFirst();
      if (quiz === undefined) {
        throw new ContractError("not_found", "This no longer exists or is not yours.", 404);
      }
      const items = await trx
        .selectFrom("quiz_items")
        .innerJoin("quiz_bank", (join) =>
          join
            .onRef("quiz_bank.bank_version", "=", "quiz_items.bank_version")
            .onRef("quiz_bank.question_id", "=", "quiz_items.question_id"),
        )
        .select([
          "quiz_items.position",
          "quiz_items.question_id",
          "quiz_bank.text",
          "quiz_items.persona_answer",
          "quiz_items.human_answer",
          "quiz_items.agree",
        ])
        .where("quiz_items.quiz_id", "=", quizId)
        .orderBy("quiz_items.position")
        .execute();
      return QuizView.parse({
        id: quiz.id,
        state: quiz.state,
        items: items.map(toQuizItemView),
        ...(quiz.matched === null ? {} : { matched: quiz.matched }),
        ...(quiz.reliable === null ? {} : { reliable: quiz.reliable }),
        copy: quizViewCopy(quiz),
      });
    });
    return reply.code(200).send(view);
  });
}
