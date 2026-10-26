import { type FormEvent, type ReactElement } from "react";
import { QUIZ_ANSWER_MAX_CHARS, type QuizItemView, type QuizView } from "@meet-first/contracts";
import { canSendAnswers } from "./quiz-state.js";

// The ten one-line answers, locked until every persona answer exists (R4.2, R4.3).
export const QuizForm = (props: { items: QuizItemView[]; answers: readonly string[]; isLocked: boolean; isSending: boolean; onChange: (position: number, text: string) => void; onSend: () => void }): ReactElement => {
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSend();
  };
  return (
    <form onSubmit={onSubmit}>
      <fieldset>
        <legend>Answer each in one line</legend>
        {props.items.map((item) => {
          const id = `quiz-answer-${String(item.position)}`;
          return (
            <div key={item.position}>
              <label htmlFor={id}>{item.questionText}</label>
              <input id={id} type="text" maxLength={QUIZ_ANSWER_MAX_CHARS} disabled={props.isLocked} value={props.answers[item.position - 1] ?? ""} onChange={(event) => { props.onChange(item.position, event.target.value); }} />
            </div>
          );
        })}
        <button type="submit" disabled={!canSendAnswers(props.answers) || props.isSending || props.isLocked}>
          Send my answers
        </button>
      </fieldset>
    </form>
  );
};

// The verdict line for one pair of answers.
function verdictLine(agree: boolean | undefined): string | null {
  if (agree === undefined) return null;
  return agree ? "Matched" : "Did not match";
}

// The judged result: the copy exactly as the server sent it, and each pair of answers (D31, R4.2).
export const QuizResult = (props: { quiz: QuizView }): ReactElement => {
  return (
    <section>
      <h2>{props.quiz.copy}</h2>
      <ol>
        {props.quiz.items.map((item) => (
          <li key={item.position}>
            <p>{item.questionText}</p>
            {item.personaAnswer === undefined ? null : <p>{`Your persona: ${item.personaAnswer}`}</p>}
            {item.humanAnswer === undefined ? null : <p>{`You: ${item.humanAnswer}`}</p>}
            {verdictLine(item.agree) === null ? null : <p>{verdictLine(item.agree)}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
};
