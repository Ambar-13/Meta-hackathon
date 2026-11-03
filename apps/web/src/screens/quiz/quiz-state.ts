import { useState } from "react";
import { QUIZ_ITEMS, type QuizView } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, routes, usePolledView, type PolledView } from "../../app-shell/index.js";

// How often the quiz screen polls while the persona answers or the judge works (the 3 s card interval).
export const QUIZ_POLL_MS = 3_000;
// Where sending the answers stands.
export type SubmitState = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; error: ApiError };

// True when all 10 answers have text after trimming.
export function canSendAnswers(answers: readonly string[]): boolean {
  return answers.length === QUIZ_ITEMS && answers.every((text) => text.trim() !== "");
}

// The quiz screen's state and actions.
export function useQuizScreen(quizId: string): { polled: PolledView<QuizView>; answers: string[]; setAnswer: (position: number, text: string) => void; submit: SubmitState; send: () => Promise<void> } {
  const polled = usePolledView(() => apiFetch(routes.cards.readQuiz, { params: { id: quizId } }), {
    key: quizId,
    intervalMs: QUIZ_POLL_MS,
    keepPolling: (quiz) => quiz.state === "answering" || quiz.state === "judging",
  });
  const [answers, setAnswers] = useState<string[]>(() => Array.from({ length: QUIZ_ITEMS }, () => ""));
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const setAnswer = (position: number, text: string): void => {
    setAnswers((previous) => previous.map((current, index) => (index === position - 1 ? text : current)));
  };

  const send = async (): Promise<void> => {
    if (!canSendAnswers(answers)) return;
    setSubmit({ kind: "sending" });
    try {
      const body = { answers: answers.map((text, index) => ({ position: index + 1, text: text.trim() })) };
      await apiFetch(routes.cards.answerQuiz, { params: { id: quizId }, body });
      setSubmit({ kind: "sent" });
      polled.reload();
    } catch (thrown: unknown) {
      setSubmit({ kind: "failed", error: asApiError(thrown) });
    }
  };

  return { polled, answers, setAnswer, submit, send };
}
