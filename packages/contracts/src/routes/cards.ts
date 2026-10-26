import { z } from "zod";
import { CardApprove, CardApproveResponse, CardView, QuizAnswers, QuizAnswersResponse, QuizRequestResponse, QuizView } from "../cards/index.js";

// Routes for cards and quizzes. Paths come from IMPLEMENTATION.md 2.2.
export const cardsRoutes = {
  readCard: { method: "GET", path: "/api/cards/:id", request: z.undefined(), response: CardView },
  approveCard: { method: "POST", path: "/api/cards/:id/approve", request: CardApprove, response: CardApproveResponse },
  requestQuiz: { method: "POST", path: "/api/cards/:id/quiz", request: z.undefined(), response: QuizRequestResponse },
  readQuiz: { method: "GET", path: "/api/quizzes/:id", request: z.undefined(), response: QuizView },
  answerQuiz: { method: "POST", path: "/api/quizzes/:id/answers", request: QuizAnswers, response: QuizAnswersResponse },
} as const;
