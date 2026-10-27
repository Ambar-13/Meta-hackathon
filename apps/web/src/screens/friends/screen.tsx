// What exists: friends are the people a person joined an invite pair with, and each friend has a switch that lets friends ask their
// persona how they would probably react (P3). The problem: the page must offer the ask only where the friend said yes, and must show
// the person every answer their own persona gave (P4). The step: one row per friend from GET /api/friends, an ask box under the chosen
// friend, and the copies from GET /api/asks. What it does not do: list strangers from the directory; asking how a stranger would react
// is not built (design section 10).
import "./friends.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AboutMeAnswer, AskSummary, Friend } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { Avatar, EmptyState, LoadingLine, NameTag, Sticker, type TagColour } from "../../look/index.js";
import { AnswerClaims } from "../ask/index.js";
import { useFriendsScreen, type FriendsScreenModel } from "./friends-state.js";

// The headings and lines of this page; the ones marked [confirm] are drafted, because design section 7 does not give them.
const FRIENDS_HEADING = "Your friends"; // [confirm]
const COPIES_HEADING = "Answers your persona gave";
const SENT_HEADING = "Asks you sent"; // [confirm]
const ASK_BUTTON_LABEL = "Ask how they would react";
const SEND_LABEL = "Send the ask"; // [confirm]
const NO_FRIENDS_TITLE = "No friends yet"; // [confirm]
const NO_FRIENDS_LINE = "Nobody yet. People you pair with by invite link show up here."; // [confirm]
const NO_FRIENDS_ACTION = "Share your invite link"; // [confirm]
const NO_COPIES_TITLE = "No answers yet"; // [confirm]
const NO_COPIES_LINE = "Your persona has not answered anyone yet."; // [confirm]
const NO_SENT_TITLE = "Nothing sent yet"; // [confirm]
const NO_SENT_LINE = "Ask a friend how they would react, or ask the directory for help."; // [confirm]
const LOADING_FRIENDS_LINE = "Loading your friends."; // [confirm]
const LOADING_COPIES_LINE = "Loading the answers your persona gave."; // [confirm]
const COPY_ANSWER_LABEL = "Your persona's answer"; // [confirm]
const ASKS_ON_LINE = "Friend asks on"; // [confirm]
const NAV_LABEL = "Find more people"; // [confirm]
// The name on the caller's own persona bubble, so its initial reads Y [confirm].
const SELF_NAME = "You"; // [confirm]
// The words for where each sent ask is, and its kind [confirm].
const SENT_STATE_LINES: Record<AskSummary["state"], string> = { checking: "Still running", asking: "Still running", ranking: "Still running", done: "Answered", refused: "Not allowed", failed: "Could not finish" }; // [confirm]
const SENT_MODE_LINES: Record<AskSummary["mode"], string> = { react: "Friend ask", help: "Help search" }; // [confirm]
// The most characters the ask box takes, the upper bound of AskCreate.
const ASK_MAX_CHARACTERS = 300;
// The band colour of the friend at this place in the list: green and lilac in turn, the colours of people outside a meeting (docs/DESIGN.md).
function friendTagColour(index: number): TagColour {
  return index % 2 === 0 ? "green" : "lilac";
}

// The line for a friend who has not turned on friend asks, in the same words as the API's friend_asks_off sentence (design section 6).
function asksOffLine(friend: Friend): string {
  return `${friend.displayName} has not turned on friend asks.`;
}

// The label of one friend's ask box; 5 to 300 characters is what AskCreate accepts after trimming [confirm].
function askBoxLabel(friend: Friend): string {
  return `What should ${friend.displayName} react to? (5 to 300 characters)`;
}

// The line that opens one copy: who asked and what, by the kind of ask [confirm].
function askedLine(copy: AboutMeAnswer): string {
  if (copy.mode === "react") return `${copy.askerName} asked how you would probably react to: ${copy.text}`;
  return `${copy.askerName} asked the directory for help: ${copy.text}`;
}

// The ask box of the chosen friend; its text stays here until it is sent.
const ReactAskForm = (props: { friend: Friend; isSending: boolean; onSend: (text: string) => void }): ReactElement => {
  const [text, setText] = useState("");
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSend(text);
  };
  return (
    <form className="friends-ask-form" onSubmit={onSubmit}>
      <label>
        {askBoxLabel(props.friend)}
        <textarea maxLength={ASK_MAX_CHARACTERS} value={text} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="submit" disabled={props.isSending}>
        {SEND_LABEL}
      </button>
    </form>
  );
};

// What one friend's row offers: the line that their friend asks are off, the ask button, or the open ask box with its errors (P3).
const FriendAction = (props: { friend: Friend; model: FriendsScreenModel }): ReactElement => {
  const { friend, model } = props;
  if (!friend.canAsk) return <p className="muted friends-off">{asksOffLine(friend)}</p>;
  const switchLine = (
    <span className="pill friends-on">
      <span className="dot c-green" aria-hidden="true" />
      {ASKS_ON_LINE}
    </span>
  );
  if (model.chosenPairId !== friend.pairId) {
    return (
      <div className="friends-action">
        {switchLine}
        <button type="button" onClick={() => { model.choose(friend.pairId); }}>
          {ASK_BUTTON_LABEL}
        </button>
      </div>
    );
  }
  return (
    <div className="friends-action">
      {switchLine}
      <ReactAskForm friend={friend} isSending={model.isSending} onSend={(text) => { void model.sendReactAsk(friend.pairId, text); }} />
      {model.formLine === null ? null : <p className="friends-form-line" role="alert">{model.formLine}</p>}
      {model.sendError === null ? null : <ErrorNotice error={model.sendError} />}
    </div>
  );
};

// The friends part: loading, an error, nobody yet, or one name tag row per friend in the order the server gives (most recently joined first).
const FriendsBody = (props: { model: FriendsScreenModel }): ReactElement => {
  const { friends } = props.model;
  if (friends.value === null) return friends.error === null ? <LoadingLine text={LOADING_FRIENDS_LINE} /> : <ErrorNotice error={friends.error} />;
  if (friends.value.friends.length === 0) {
    const action = <Link className="btn" to={APP_PATHS.home}>{NO_FRIENDS_ACTION}</Link>;
    return <EmptyState sticker="tags" title={NO_FRIENDS_TITLE} action={action}>{NO_FRIENDS_LINE}</EmptyState>;
  }
  return (
    <ul className="friends-list">
      {friends.value.friends.map((friend, index) => (
        <li className="friends-row" key={friend.pairId}>
          <NameTag name={friend.displayName} colour={friendTagColour(index)} className="friends-tag wide" />
          <strong className="friends-name">{friend.displayName}</strong>
          <FriendAction friend={friend} model={props.model} />
        </li>
      ))}
    </ul>
  );
};

// One copy as a short talk: the asker's blue bubble with what they asked, then your persona's coral bubble with its answer and quotes.
const CopyItem = (props: { copy: AboutMeAnswer }): ReactElement => {
  const { copy } = props;
  return (
    <li className="friends-copy">
      <div className="talk">
        <div className="msg b">
          <Avatar name={copy.askerName} side="b" />
          <div className="bubble">
            <p>{askedLine(copy)}</p>
          </div>
        </div>
        <div className="msg a">
          <Avatar name={SELF_NAME} side="a" />
          <div className="bubble">
            <span className="who">{COPY_ANSWER_LABEL}</span>
            <p>{copy.answer}</p>
          </div>
          <div className="extra">
            <AnswerClaims claims={copy.claims} />
          </div>
        </div>
      </div>
    </li>
  );
};

// The copies part: every answer the caller's persona gave, newest first, with who asked, what, the answer and its claims (P4).
const CopiesBody = (props: { model: FriendsScreenModel }): ReactElement => {
  const { asks } = props.model;
  if (asks.value === null) return asks.error === null ? <LoadingLine text={LOADING_COPIES_LINE} /> : <ErrorNotice error={asks.error} />;
  if (asks.value.aboutMe.length === 0) return <EmptyState sticker="chat" title={NO_COPIES_TITLE}>{NO_COPIES_LINE}</EmptyState>;
  return (
    <ul className="friends-copies">
      {asks.value.aboutMe.map((copy) => (
        <CopyItem key={copy.answerId} copy={copy} />
      ))}
    </ul>
  );
};

// The asks the caller sent, newest first, under their own heading: each one's kind, its question and where it is, linking to its
// answers page. Shown once the asks have loaded; the copies part above already shows the loading line and any error.
const SentBody = (props: { model: FriendsScreenModel }): ReactElement | null => {
  const { asks } = props.model;
  if (asks.value === null) return null;
  if (asks.value.asked.length === 0) {
    return (
      <section>
        <h2>{SENT_HEADING}</h2>
        <EmptyState sticker="ask" title={NO_SENT_TITLE}>{NO_SENT_LINE}</EmptyState>
      </section>
    );
  }
  return (
    <section>
      <h2>{SENT_HEADING}</h2>
      <ul className="friends-sent">
        {asks.value.asked.map((ask) => (
          <li key={ask.askId}>
            <Link className="friends-sent-link" to={APP_PATHS.ask(ask.askId)}>
              <span className="friends-sent-kind">{SENT_MODE_LINES[ask.mode]}</span>
              <span className="friends-sent-text">{ask.text}</span>
              <span className={ask.state === "done" ? "pill friends-sent-state is-done" : "pill friends-sent-state"}>{SENT_STATE_LINES[ask.state]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

// The /friends page: your friends with the ask button, the answers your persona gave, the asks you sent, and links to Find help and the
// Directory (design section 7). On a laptop the friends sit beside the answers.
export const FriendsScreen = (): ReactElement => {
  const navigate = useNavigate();
  const model = useFriendsScreen((path) => {
    navigate(path);
  });
  return (
    <ScreenFrame title="Friends" isWide>
      <div className="friends-columns">
        <div className="friends-side">
          <section>
            <h2>{FRIENDS_HEADING}</h2>
            <FriendsBody model={model} />
          </section>
          <nav aria-label={NAV_LABEL} className="friends-more">
            <Link className="chip c-lilac" to={APP_PATHS.help}>
              <Sticker name="buoy" />
              Find help
            </Link>
            <Link className="chip c-green" to={APP_PATHS.directory}>
              <Sticker name="tags" />
              Directory
            </Link>
          </nav>
        </div>
        <div className="friends-main">
          <section>
            <h2>{COPIES_HEADING}</h2>
            <CopiesBody model={model} />
          </section>
          <SentBody model={model} />
        </div>
      </div>
    </ScreenFrame>
  );
};
