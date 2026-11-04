import "./quiz.css";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import type { QuizView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, LoadingLine } from "../../look/index.js";
import { QuizForm, QuizResult } from "./quiz-parts.js";
import { useQuizScreen, type SubmitState } from "./quiz-state.js";

// The words for a quiz that is not answered yet: the persona first, then the form.
const AnsweringLine = (): ReactElement => (
  <LoadingLine text="Your Meety answers first. The form opens when it is done." />
);

// The status of sending the answers: the word while sending, the error when it failed.
const SubmitStatus = (props: { submit: SubmitState }): ReactElement | null => {
  if (props.submit.kind === "sending") return <LoadingLine text="Sending." />;
  if (props.submit.kind === "failed") return <ErrorNotice error={props.submit.error} />;
  return null;
};

// The line for each state after the answers are in or while they are scored.
const StateLine = (props: { quiz: QuizView }): ReactElement | null => {
  if (props.quiz.state === "judging") return <LoadingLine text="Comparing your answers." />;
  if (props.quiz.state === "judged") return <QuizResult quiz={props.quiz} />;
  if (props.quiz.state === "failed") {
    const home = (
      <Link className="btn" to={APP_PATHS.home}>
        Go home
      </Link>
    );
    return (
      <EmptyState sticker="poof" title="The quiz could not be scored this time." action={home} />
    );
  }
  return null;
};

// The /quizzes/:quizId page: wait for the persona, answer, read the result.
export const QuizScreen = (): ReactElement => {
  const quizId = useParams()["quizId"] ?? "";
  const { polled, answers, setAnswer, submit, send } = useQuizScreen(quizId);
  const quiz = polled.value;
  if (quiz === null) {
    return (
      <ScreenFrame title="Knows-me quiz">
        {polled.error === null ? (
          <LoadingLine text="Loading the quiz." />
        ) : (
          <ErrorNotice error={polled.error} />
        )}
      </ScreenFrame>
    );
  }
  const isLocked = quiz.state === "answering";
  const isOpen = quiz.state === "answering" || quiz.state === "waiting_human";
  return (
    <ScreenFrame title="Knows-me quiz">
      {isOpen ? (
        <p className="quiz-lead">
          Ten questions about you. Your Meety answers them too, then a judge compares.
        </p>
      ) : null}
      {isLocked ? <AnsweringLine /> : null}
      {isOpen ? (
        <QuizForm
          items={quiz.items}
          answers={answers}
          isLocked={isLocked}
          isSending={submit.kind === "sending"}
          onChange={setAnswer}
          onSend={() => void send()}
        />
      ) : null}
      <SubmitStatus submit={submit} />
      <StateLine quiz={quiz} />
    </ScreenFrame>
  );
};
