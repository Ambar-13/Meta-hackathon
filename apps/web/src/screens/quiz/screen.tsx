import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import type { QuizView } from "@meet-first/contracts";
import { ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { QuizForm, QuizResult } from "./quiz-parts.js";
import { useQuizScreen, type SubmitState } from "./quiz-state.js";

// The words for a quiz that is not answered yet: the persona first, then the form.
const AnsweringLine = (): ReactElement => <p>Your persona answers first. The form opens when it is done.</p>;

// The status of sending the answers: the word while sending, the error when it failed.
const SubmitStatus = (props: { submit: SubmitState }): ReactElement | null => {
  if (props.submit.kind === "sending") return <p role="status">Sending.</p>;
  if (props.submit.kind === "failed") return <ErrorNotice error={props.submit.error} />;
  return null;
};

// The line for each state after the answers are in or while they are scored.
const StateLine = (props: { quiz: QuizView }): ReactElement | null => {
  if (props.quiz.state === "judging") return <p>Comparing your answers.</p>;
  if (props.quiz.state === "judged") return <QuizResult quiz={props.quiz} />;
  if (props.quiz.state === "failed") return <p>The quiz could not be scored this time.</p>;
  return null;
};

// The /quizzes/:quizId page: wait for the persona, answer, read the result (R4.2, D31).
export const QuizScreen = (): ReactElement => {
  const quizId = useParams()["quizId"] ?? "";
  const { polled, answers, setAnswer, submit, send } = useQuizScreen(quizId);
  const quiz = polled.value;
  if (quiz === null) {
    return <ScreenFrame title="Knows-me quiz">{polled.error === null ? <p>Loading the quiz.</p> : <ErrorNotice error={polled.error} />}</ScreenFrame>;
  }
  const isLocked = quiz.state === "answering";
  const isOpen = quiz.state === "answering" || quiz.state === "waiting_human";
  return (
    <ScreenFrame title="Knows-me quiz">
      {isLocked ? <AnsweringLine /> : null}
      {isOpen ? (
        <QuizForm items={quiz.items} answers={answers} isLocked={isLocked} isSending={submit.kind === "sending"} onChange={setAnswer} onSend={() => void send()} />
      ) : null}
      <SubmitStatus submit={submit} />
      <StateLine quiz={quiz} />
    </ScreenFrame>
  );
};
