// The quiz routes as one plugin for apps/api/src/server.ts: create, read, submit answers (IMPLEMENTATION.md 2.2).
import type { RoutePlugin } from "../app-types.js";
import { registerCreateQuiz } from "./create-quiz.js";
import { registerReadQuiz } from "./read-quiz.js";
import { registerSubmitAnswers } from "./submit-answers.js";

// The three quiz routes, registered in this order on the root instance (seams S2).
export const registerQuizRoutes: RoutePlugin = (app, deps) => {
  registerCreateQuiz(app, deps);
  registerReadQuiz(app, deps);
  registerSubmitAnswers(app, deps);
  return Promise.resolve();
};

// The helpers that other folders and the tests may import from the quiz routes.
export { assertCardCanQuiz, insertQuiz } from "./create-quiz.js";
// The shape of one item of a quiz view, and the copy of the whole quiz.
export { toQuizItemView, quizViewCopy } from "./read-quiz.js";
// The check for answers, and the write of the ten human answers.
export { assertQuizWaitingHuman, storeHumanAnswers } from "./submit-answers.js";
