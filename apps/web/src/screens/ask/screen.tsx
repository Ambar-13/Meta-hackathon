// What exists: an ask runs in the worker, and its answers arrive in persona_answers. The problem:
// the asker needs to see the answers as soon as the ask ends, with their receipts, and to meet a
// helper from the results. The step: this page reads the ask until it ends, then shows a help
// search's results or a friend ask's one answer. What it does not do: show a position, a count or a
// rank, or any number about a person.
import "./ask.css";
import type { ReactElement } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { HELP_RESULTS_HEADING, type AskView } from "@meet-first/contracts";
import {
  APP_PATHS,
  ErrorNotice,
  readApprovedCard,
  readCardQuery,
  ScreenFrame,
} from "../../app-shell/index.js";
import { Avatar, LoadingLine, Sticker, TypingDots } from "../../look/index.js";
import { AnswerClaims, HelpAnswerItem } from "./answer-parts.js";
import { splitHelpAnswers, useAskScreen, type AskScreenModel } from "./ask-state.js";

// The lines of this page.
const LOADING_LINE = "Loading the answers.";
const ASKED_PREFIX = "You asked: ";
const WAITING_LINES = {
  checking: "Checking your question.",
  asking: "Asking their Meetys. This takes about a minute.",
  ranking: "Checking the quotes in each answer.",
} as const;
const FAILED_LINE = "This ask could not finish. Try again.";
const REFUSED_FALLBACK_LINE = "The question check did not allow this question.";
const NO_MATCH_LINE = "Nobody in Explore matches this yet.";
const NONE_PLACED_LINE = "No Meety showed a clear sign. Their answers are below.";
const NO_SIGN_HEADING = "No clear sign in their notes";
const FRIEND_FALLBACK_NAME = "your friend";
// The way on from a refused or failed ask: back to the box it came from, by its kind.
const AGAIN_LINKS = {
  help: { label: "Ask a different question", to: APP_PATHS.help },
  react: { label: "Back to your friends", to: APP_PATHS.friends },
  self: { label: "Back to your profile", to: APP_PATHS.me },
} as const;
// The name on the asker's own bubble, so its initial reads Y.
const ASKER_NAME = "You";

// One answer of the view.
type Answer = AskView["answers"][number];

// The question as the asker's own coral bubble at the top of the page.
const AskedBubble = (props: { view: AskView }): ReactElement => {
  return (
    <div className="talk ask-asked">
      <div className="msg a">
        <Avatar name={ASKER_NAME} side="a" />
        <div className="bubble">
          <p>{`${ASKED_PREFIX}${props.view.text}`}</p>
        </div>
      </div>
    </div>
  );
};

// The ask while it runs: a blue bubble with typing dots from the friend, or from the personas of a
// help search, and the step it is on.
const WaitingBubble = (props: { view: AskView; line: string }): ReactElement => {
  const { view } = props;
  return (
    <>
      <div className="talk ask-waiting">
        <div className="msg b">
          {view.mode !== "help" && view.aboutName !== null ? (
            <Avatar name={view.aboutName} side="b" />
          ) : (
            <span className="avatar c-blue ask-face" aria-hidden="true">
              <Sticker name="chat" />
            </span>
          )}
          <div className="bubble writing">
            <TypingDots label={props.line} />
          </div>
        </div>
      </div>
      <p className="ask-waiting-line">{props.line}</p>
    </>
  );
};

// A refused or failed ask: the sentence in the notice, then the way back to where the question was
// asked.
const EndedNotice = (props: { view: AskView; line: string }): ReactElement => {
  const again = AGAIN_LINKS[props.view.mode];
  return (
    <div className="notice" role="alert">
      <p>{props.line}</p>
      <Link to={again.to}>{again.label}</Link>
    </div>
  );
};

// The finished help search: the placed answers under the results heading, then the answers that
// showed no clear sign.
const HelpResults = (props: {
  view: AskView;
  cardId: string | null;
  model: AskScreenModel;
}): ReactElement => {
  const { placed, unplaced } = splitHelpAnswers(props.view.answers);
  const onMeet = (answerId: string, cardId: string): void => {
    void props.model.startMeeting(answerId, cardId);
  };
  const toItem = (answer: Answer): ReactElement => (
    <HelpAnswerItem
      key={answer.answerId}
      answer={answer}
      cardId={props.cardId}
      isBusy={props.model.isMeeting}
      onMeet={onMeet}
    />
  );
  return (
    <>
      <section className="ask-section">
        <h2>{HELP_RESULTS_HEADING}</h2>
        {props.view.answers.length === 0 ? <p className="ask-none">{NO_MATCH_LINE}</p> : null}
        {props.view.answers.length > 0 && placed.length === 0 ? (
          <p className="ask-none">{NONE_PLACED_LINE}</p>
        ) : null}
        {placed.length > 0 ? (
          <ul className="ask-answers">{placed.map((answer) => toItem(answer))}</ul>
        ) : null}
      </section>
      {unplaced.length > 0 ? (
        <section className="ask-section">
          <h2>{NO_SIGN_HEADING}</h2>
          <ul className="ask-answers">{unplaced.map((answer) => toItem(answer))}</ul>
        </section>
      ) : null}
    </>
  );
};

// The finished friend ask, or self ask: how the person would react, as their blue bubble with its
// quotes under it.
const ReactResult = (props: { view: AskView }): ReactElement => {
  const answer = props.view.answers[0];
  const name = props.view.aboutName ?? FRIEND_FALLBACK_NAME;
  return (
    <section className="ask-section">
      <h2>{`How ${name} would probably react`}</h2>
      {answer === undefined ? (
        <div className="notice">
          <p>{FAILED_LINE}</p>
        </div>
      ) : (
        <div className="talk">
          <div className="msg b">
            <Avatar name={name} side="b" />
            <div className="bubble">
              <p>{answer.answer}</p>
            </div>
            <div className="extra ask-extra">
              <AnswerClaims claims={answer.claims} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// The part under the question: the waiting bubble, the refusal, the failure, or the finished
// answers.
const AskBody = (props: {
  view: AskView;
  cardId: string | null;
  model: AskScreenModel;
}): ReactElement => {
  const { view } = props;
  if (view.state === "checking" || view.state === "asking" || view.state === "ranking")
    return <WaitingBubble view={view} line={WAITING_LINES[view.state]} />;
  if (view.state === "refused")
    return <EndedNotice view={view} line={view.refusedReason ?? REFUSED_FALLBACK_LINE} />;
  if (view.state === "failed") return <EndedNotice view={view} line={FAILED_LINE} />;
  if (view.mode !== "help") return <ReactResult view={view} />;
  return <HelpResults view={view} cardId={props.cardId} model={props.model} />;
};

// The /asks/:askId page: reads the ask every ASK_POLL_MS until it ends, then shows its answers with
// their receipts. The card for a meeting is the card query of this address, else the card this tab
// approved, as on the lobby page.
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
    return (
      <ScreenFrame title="Answers">
        {model.ask.error === null ? (
          <LoadingLine text={LOADING_LINE} />
        ) : (
          <ErrorNotice error={model.ask.error} />
        )}
      </ScreenFrame>
    );
  }
  return (
    <ScreenFrame title="Answers">
      <AskedBubble view={view} />
      <AskBody view={view} cardId={cardId} model={model} />
      {model.meetError === null ? null : <ErrorNotice error={model.meetError} />}
    </ScreenFrame>
  );
};
