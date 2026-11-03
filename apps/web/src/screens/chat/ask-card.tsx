// The ask under a running reply: it reads the ask every ASK_POLL_MS until it is done, refused or failed, and fills in as the agents
// answer. A read error is one quiet line with a link to the ask page, never a full error notice inside the thread.
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { ASK_POLL_MS, type AskMode, type AskView } from "@meet-first/contracts";
import { apiFetch, APP_PATHS, routes, usePolledView, type PolledView } from "../../app-shell/index.js";
import { PersonAvatar, TypingDots } from "../../look/index.js";
import { isAskRunning } from "../ask/ask-state.js";
import { ASK_CARD_ANSWERS_MAX, firstSentence } from "./chat-words.js";

// The small grey words over each kind of ask.
export const ASK_KIND_CHIP: Record<AskMode, { label: string }> = {
  help: { label: "Help search" },
  react: { label: "Friend ask" },
};

// The waiting line of each running state of an ask.
const WAITING_LINES = { checking: "Checking the question", asking: "Agents are answering", ranking: "Putting the answers in order" } as const;
// The other lines of the card.
const LOADING_LINE = "Loading the ask";
const NO_ANSWERS_LINE = "Nobody's agent had an answer this time.";
const FAILED_LINE = "This ask could not finish. Try asking again in a minute.";
const READ_ERROR_LINE = "Could not load this ask.";
const SEE_ANSWERS = "See the answers";
// The refusal line when the ask came back with no reason.
const REFUSED_FALLBACK = "the question check said no";

// Typing dots with the words beside them; the dots carry the words for screen readers.
export const WaitLine = (props: { text: string }): ReactElement => {
  return (
    <p className="chat-wait">
      <TypingDots label={props.text} />
      <span aria-hidden="true">{props.text}</span>
    </p>
  );
};

// The colour of a card by its kind: a help search is yellow everywhere, a friend ask coral.
export function kindTint(mode: AskMode): string {
  return mode === "help" ? "c-yellow" : "c-coral";
}

// The kind's words and the question at the top of a plan or an ask.
export const KindHead = (props: { mode: AskMode; question: string }): ReactElement => {
  const chip = ASK_KIND_CHIP[props.mode];
  return (
    <>
      <span className="chat-kind">{chip.label}</span>
      <p className="chat-question">{`“${props.question}”`}</p>
    </>
  );
};

// The finished ask: up to ASK_CARD_ANSWERS_MAX answers, each with the answerer's face, name and first sentence, then the link.
const AskAnswers = (props: { view: AskView }): ReactElement => {
  const shown = props.view.answers.slice(0, ASK_CARD_ANSWERS_MAX);
  return (
    <>
      {shown.length === 0 ? (
        <p className="chat-ask-line">{NO_ANSWERS_LINE}</p>
      ) : (
        <ul className="chat-answers">
          {shown.map((answer) => (
            <li key={answer.answerId}>
              <PersonAvatar name={answer.displayName} size="s" />
              <span>
                <strong>{`${answer.displayName}'s agent`}</strong>
                <span className="chat-answer-line">{firstSentence(answer.answer)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link className="chat-see" to={APP_PATHS.ask(props.view.askId)}>{SEE_ANSWERS}</Link>
    </>
  );
};

// What the card shows under its question for each state of the ask.
const AskBody = (props: { view: AskView }): ReactElement => {
  const { view } = props;
  if (view.state === "checking" || view.state === "asking" || view.state === "ranking") return <WaitLine text={WAITING_LINES[view.state]} />;
  if (view.state === "refused") return <p className="chat-ask-line">{`This question was not allowed: ${view.refusedReason ?? REFUSED_FALLBACK}`}</p>;
  if (view.state === "failed") return <p className="chat-ask-line">{FAILED_LINE}</p>;
  return <AskAnswers view={view} />;
};

// The quiet line for an ask that could not be read, with a link to its own page.
const ReadError = (props: { askId: string }): ReactElement => {
  return (
    <p className="chat-ask-line">
      {READ_ERROR_LINE} <Link to={APP_PATHS.ask(props.askId)}>Open the ask</Link>
    </p>
  );
};

// What the card shows under its question: the loading line, the ask by its state, or the read error.
const AskState = (props: { ask: PolledView<AskView>; askId: string }): ReactElement => {
  const view = props.ask.value;
  if (view !== null) return <AskBody view={view} />;
  return props.ask.error === null ? <WaitLine text={LOADING_LINE} /> : <ReadError askId={props.askId} />;
};

// The ask card of a running or finished reply; mode and question come from the reply until the ask is read.
export const AskCard = (props: { askId: string; mode: AskMode; question: string }): ReactElement => {
  const ask = usePolledView(() => apiFetch(routes.asks.readAsk, { params: { id: props.askId } }), { key: props.askId, intervalMs: ASK_POLL_MS, keepPolling: isAskRunning });
  const question = props.question === "" ? (ask.value?.text ?? "") : props.question;
  return (
    <section className={`chat-card ${kindTint(ask.value?.mode ?? props.mode)}`} aria-label="The ask">
      <KindHead mode={ask.value?.mode ?? props.mode} question={question} />
      <AskState ask={ask} askId={props.askId} />
    </section>
  );
};
