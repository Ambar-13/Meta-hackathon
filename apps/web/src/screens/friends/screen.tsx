// What exists: friends are the people a person joined an invite pair with, and each friend has a switch that lets friends ask their
// persona how they would probably react (P3). The problem: the page must offer the ask only where the friend said yes, and must show
// the person every answer their own persona gave (P4). The step: one row per friend from GET /api/friends, an ask box under the chosen
// friend, and the copies from GET /api/asks. What it does not do: list strangers from the directory; asking how a stranger would react
// is not built (design section 10).
import { useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AboutMeAnswer, Friend } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { AnswerClaims } from "../ask/index.js";
import { useFriendsScreen, type FriendsScreenModel } from "./friends-state.js";

// The headings and lines of this page; the ones marked [confirm] are drafted, because design section 7 does not give them.
const FRIENDS_HEADING = "Your friends"; // [confirm]
const COPIES_HEADING = "Answers your persona gave";
const ASK_BUTTON_LABEL = "Ask how they would react";
const SEND_LABEL = "Send the ask"; // [confirm]
const NO_FRIENDS_LINE = "Nobody yet. People you pair with by invite link show up here."; // [confirm]
const NO_COPIES_LINE = "Your persona has not answered anyone yet."; // [confirm]
const LOADING_FRIENDS_LINE = "Loading your friends."; // [confirm]
const LOADING_COPIES_LINE = "Loading the answers your persona gave."; // [confirm]
const COPY_ANSWER_LABEL = "Your persona's answer"; // [confirm]
const NAV_LABEL = "Find more people"; // [confirm]
// The most characters the ask box takes, the upper bound of AskCreate.
const ASK_MAX_CHARACTERS = 300;

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
    <form onSubmit={onSubmit}>
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
  if (!friend.canAsk) return <p className="muted">{asksOffLine(friend)}</p>;
  if (model.chosenPairId !== friend.pairId) {
    return (
      <button type="button" onClick={() => { model.choose(friend.pairId); }}>
        {ASK_BUTTON_LABEL}
      </button>
    );
  }
  return (
    <>
      <ReactAskForm friend={friend} isSending={model.isSending} onSend={(text) => { void model.sendReactAsk(friend.pairId, text); }} />
      {model.formLine === null ? null : <p role="alert">{model.formLine}</p>}
      {model.sendError === null ? null : <ErrorNotice error={model.sendError} />}
    </>
  );
};

// The friends part: loading, an error, nobody yet, or one row per friend in the order the server gives (most recently joined first).
const FriendsBody = (props: { model: FriendsScreenModel }): ReactElement => {
  const { friends } = props.model;
  if (friends.value === null) return friends.error === null ? <p>{LOADING_FRIENDS_LINE}</p> : <ErrorNotice error={friends.error} />;
  if (friends.value.friends.length === 0) return <p>{NO_FRIENDS_LINE}</p>;
  return (
    <ul>
      {friends.value.friends.map((friend) => (
        <li className="panel" key={friend.pairId}>
          <p>
            <strong>{friend.displayName}</strong>
          </p>
          <FriendAction friend={friend} model={props.model} />
        </li>
      ))}
    </ul>
  );
};

// The copies part: every answer the caller's persona gave, newest first, with who asked, what, the answer and its claims (P4).
const CopiesBody = (props: { model: FriendsScreenModel }): ReactElement => {
  const { asks } = props.model;
  if (asks.value === null) return asks.error === null ? <p>{LOADING_COPIES_LINE}</p> : <ErrorNotice error={asks.error} />;
  if (asks.value.aboutMe.length === 0) return <p>{NO_COPIES_LINE}</p>;
  return (
    <ul>
      {asks.value.aboutMe.map((copy) => (
        <li className="panel" key={copy.answerId}>
          <p>{askedLine(copy)}</p>
          <p className="muted">{COPY_ANSWER_LABEL}</p>
          <p>{copy.answer}</p>
          <AnswerClaims claims={copy.claims} />
        </li>
      ))}
    </ul>
  );
};

// The /friends page: your friends with the ask button, the answers your persona gave, and links to Find help and the Directory
// (design section 7).
export const FriendsScreen = (): ReactElement => {
  const navigate = useNavigate();
  const model = useFriendsScreen((path) => {
    navigate(path);
  });
  return (
    <ScreenFrame title="Friends">
      <section>
        <h2>{FRIENDS_HEADING}</h2>
        <FriendsBody model={model} />
      </section>
      <section>
        <h2>{COPIES_HEADING}</h2>
        <CopiesBody model={model} />
      </section>
      <nav aria-label={NAV_LABEL} className="screen-footer">
        <Link to={APP_PATHS.help}>Find help</Link>{" "}
        <Link to={APP_PATHS.directory}>Directory</Link>
      </nav>
    </ScreenFrame>
  );
};
