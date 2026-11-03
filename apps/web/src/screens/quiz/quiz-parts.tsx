import { type FormEvent, type ReactElement } from "react";
import { QUIZ_ANSWER_MAX_CHARS, type QuizItemView, type QuizView } from "@meet-first/contracts";
import { Sticker } from "../../look/index.js";
import { canSendAnswers } from "./quiz-state.js";

// A question's position as two digits, the number shown beside it.
function twoDigits(position: number): string {
  return String(position).padStart(2, "0");
}

// The ten one-line answers, locked until every persona answer exists.
export const QuizForm = (props: { items: QuizItemView[]; answers: readonly string[]; isLocked: boolean; isSending: boolean; onChange: (position: number, text: string) => void; onSend: () => void }): ReactElement => {
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSend();
  };
  return (
    <form className="quiz-form" onSubmit={onSubmit}>
      <fieldset>
        <legend>Answer each in one line</legend>
        <ol className="quiz-questions">
          {props.items.map((item) => {
            const id = `quiz-answer-${String(item.position)}`;
            return (
              <li key={item.position}>
                <b aria-hidden="true">{twoDigits(item.position)}</b>
                <label htmlFor={id}>{item.questionText}</label>
                <input id={id} type="text" maxLength={QUIZ_ANSWER_MAX_CHARS} disabled={props.isLocked} value={props.answers[item.position - 1] ?? ""} onChange={(event) => { props.onChange(item.position, event.target.value); }} />
              </li>
            );
          })}
        </ol>
        <div className="quiz-send-bar">
          <button type="submit" disabled={!canSendAnswers(props.answers) || props.isSending || props.isLocked}>
            Send my answers
          </button>
        </div>
      </fieldset>
    </form>
  );
};

// The verdict line for one pair of answers.
function verdictLine(agree: boolean | undefined): string | null {
  if (agree === undefined) return null;
  return agree ? "Matched" : "Did not match";
}

// The judged result: the copy exactly as the server sent it, and each pair of answers.
export const QuizResult = (props: { quiz: QuizView }): ReactElement => {
  return (
    <section className="quiz-result">
      <div className={props.quiz.reliable === false ? "colour-panel c-yellow quiz-score is-rough" : "colour-panel c-yellow quiz-score"}>
        <Sticker name="spark" />
        <h2>{props.quiz.copy}</h2>
        <p>How close your Meety came to your own answers.</p>
      </div>
      <ol className="quiz-pairs">
        {props.quiz.items.map((item) => (
          <li key={item.position}>
            <b aria-hidden="true">{twoDigits(item.position)}</b>
            <div>
              <p className="quiz-pair-question">{item.questionText}</p>
              {item.personaAnswer === undefined ? null : <p className="quiz-answer is-persona">{`Your Meety: ${item.personaAnswer}`}</p>}
              {item.humanAnswer === undefined ? null : <p className="quiz-answer">{`You: ${item.humanAnswer}`}</p>}
              {verdictLine(item.agree) === null ? null : <p className={item.agree === true ? "verdict is-match" : "verdict"}>{verdictLine(item.agree)}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};
