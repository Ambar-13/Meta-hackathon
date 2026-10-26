// What exists: an ask runs in the worker, and its answers arrive in persona_answers (design section 4). The problem: the asker needs
// to see the answers as soon as the ask ends, with their receipts, and to meet a helper from the results. The step: this page reads
// the ask until it ends, then shows a help search's results or a friend ask's one answer. What it does not do: show a position, a
// count or a rank, or any number about a person (design section 10).
import type { ReactElement } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { HELP_RESULTS_HEADING, type AskView } from "@meet-first/contracts";
import { ErrorNotice, readApprovedCard, readCardQuery, ScreenFrame } from "../../app-shell/index.js";
import { AnswerClaims, HelpAnswerItem } from "./answer-parts.js";
import { splitHelpAnswers, useAskScreen, type AskScreenModel } from "./ask-state.js";

// The lines of this page; the ones marked [confirm] are drafted, because design section 7 does not give them.
const LOADING_LINE = "Loading the answers."; // [confirm]
const ASKED_PREFIX = "You asked: "; // [confirm]
const WAITING_LINES = { checking: "Checking your question.", asking: "Asking the personas. This takes about a minute.", ranking: "Checking the quotes in each answer." } as const; // [confirm]
const FAILED_LINE = "This ask could not finish. Try again.";
const REFUSED_FALLBACK_LINE = "The question check did not allow this question."; // [confirm]
const NO_MATCH_LINE = "No listed persona matches this yet.";
const NONE_PLACED_LINE = "No persona showed a clear sign. Their answers are below."; // [confirm]
const NO_SIGN_HEADING = "No clear sign in their notes";
const FRIEND_FALLBACK_NAME = "your friend"; // [confirm]

// One answer of the view.
type Answer = AskView["answers"][number];

// The finished help search: the placed answers under the results heading, then the answers that showed no clear sign (design section 7).
const HelpResults = (props: { view: AskView; cardId: string | null; model: AskScreenModel }): ReactElement => {
  const { placed, unplaced } = splitHelpAnswers(props.view.answers);
  const onMeet = (answerId: string, cardId: string): void => {
    void props.model.startMeeting(answerId, cardId);
  };
  const toItem = (answer: Answer): ReactElement => <HelpAnswerItem key={answer.answerId} answer={answer} cardId={props.cardId} isBusy={props.model.isMeeting} onMeet={onMeet} />;
  return (
    <>
      <section>
        <h2>{HELP_RESULTS_HEADING}</h2>
        {props.view.answers.length === 0 ? <p>{NO_MATCH_LINE}</p> : null}
        {props.view.answers.length > 0 && placed.length === 0 ? <p>{NONE_PLACED_LINE}</p> : null}
        {placed.length > 0 ? <ul>{placed.map((answer) => toItem(answer))}</ul> : null}
      </section>
      {unplaced.length > 0 ? (
        <section>
          <h2>{NO_SIGN_HEADING}</h2>
          <ul>{unplaced.map((answer) => toItem(answer))}</ul>
        </section>
      ) : null}
    </>
  );
};

// The finished friend ask: how the friend would probably react, the answer and its claims (design section 7).
const ReactResult = (props: { view: AskView }): ReactElement => {
  const answer = props.view.answers[0];
  return (
    <section>
      <h2>{`How ${props.view.aboutName ?? FRIEND_FALLBACK_NAME} would probably react`}</h2>
      {answer === undefined ? (
        <p>{FAILED_LINE}</p>
      ) : (
        <>
          <p>{answer.answer}</p>
          <AnswerClaims claims={answer.claims} />
        </>
      )}
    </section>
  );
};

// The part under "You asked": the waiting line, the refusal, the failure, or the finished answers.
const AskBody = (props: { view: AskView; cardId: string | null; model: AskScreenModel }): ReactElement => {
  const { view } = props;
  if (view.state === "checking" || view.state === "asking" || view.state === "ranking") return <p role="status">{WAITING_LINES[view.state]}</p>;
  if (view.state === "refused") return <div className="notice" role="alert"><p>{view.refusedReason ?? REFUSED_FALLBACK_LINE}</p></div>;
  if (view.state === "failed") return <div className="notice" role="alert"><p>{FAILED_LINE}</p></div>;
  if (view.mode === "react") return <ReactResult view={view} />;
  return <HelpResults view={view} cardId={props.cardId} model={props.model} />;
};

// The /asks/:askId page: reads the ask every ASK_POLL_MS until it ends, then shows its answers with their receipts (design section 7).
// The card for a meeting is the card query of this address, else the card this tab approved, as on the lobby page [confirm].
export const AskScreen = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const askId = useParams()["askId"] ?? "";
  const cardId = readCardQuery(location.search) ?? readApprovedCard();
  const model = useAskScreen(askId, (path) => {
    navigate(path);
  });
  const view = model.ask.value;
  if (view === null) {
    return <ScreenFrame title="Answers">{model.ask.error === null ? <p>{LOADING_LINE}</p> : <ErrorNotice error={model.ask.error} />}</ScreenFrame>;
  }
  return (
    <ScreenFrame title="Answers">
      <p>{`${ASKED_PREFIX}${view.text}`}</p>
      <AskBody view={view} cardId={cardId} model={model} />
      {model.meetError === null ? null : <ErrorNotice error={model.meetError} />}
    </ScreenFrame>
  );
};
