import { quizCopy } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { QuizScreen } from "../../../screens/quiz/index.js";
import { IDS, quizView } from "../../fixtures.js";
import { FOREVER_MS } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// The quiz page's address for the fixture quiz.
const QUIZ_URL = APP_PATHS.quiz(IDS.quiz);

// One quiz view on the quiz route, reading the given quiz.
function quizOnRoute(name: string, title: string, body: unknown): GalleryView {
  return {
    name,
    title,
    pattern: ROUTE_PATTERNS.quiz,
    url: QUIZ_URL,
    element: <QuizScreen />,
    stubs: [{ route: routes.cards.readQuiz, replies: { status: 200, body } }],
  };
}

// The quiz page in each state, from loading to the result.
export const views: readonly GalleryView[] = [
  {
    name: "quiz-loading",
    title: "Quiz, loading",
    pattern: ROUTE_PATTERNS.quiz,
    url: QUIZ_URL,
    element: <QuizScreen />,
    stubs: [
      {
        route: routes.cards.readQuiz,
        replies: { status: 200, body: quizView("answering"), delayMs: FOREVER_MS },
      },
    ],
  },
  {
    name: "quiz-error",
    title: "Quiz, could not load",
    pattern: ROUTE_PATTERNS.quiz,
    url: QUIZ_URL,
    element: <QuizScreen />,
  },
  quizOnRoute("quiz-answering", "Quiz, the persona answers first", quizView("answering")),
  quizOnRoute("quiz-open", "Quiz, the form is open", quizView("waiting_human")),
  quizOnRoute("quiz-judging", "Quiz, comparing", quizView("judging")),
  quizOnRoute("quiz-judged", "Quiz, the result", quizView("judged")),
  quizOnRoute("quiz-judged-rough", "Quiz, the result the judge was unsure of", {
    ...quizView("judged"),
    reliable: false,
    copy: quizCopy(7, false),
  }),
  quizOnRoute("quiz-failed", "Quiz, could not be scored", quizView("failed")),
];
