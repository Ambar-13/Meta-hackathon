// What exists: friends are the people a person joined a pair with, by an invite link or an accepted friend request (wave 7), and each
// friend has a switch that lets friends ask their persona how they would probably react (P3). The problem: the page must show the
// requests to answer first, offer the ask only where the friend said yes, and show the person every answer their own persona gave
// (P4). The step: incoming requests with Accept and Decline, one row per friend with the ask box and Meet, the requests you sent, then
// the copies from GET /api/asks. What it does not do: ask how a stranger would react; that is not built (design section 10).
import "./friends.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AboutMeAnswer, AskSummary, Friend, FriendRequestView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { Avatar, EmptyState, LoadingLine, PersonAvatar } from "../../look/index.js";
import { AnswerClaims } from "../ask/index.js";
import { useFriendsScreen, type FriendsScreenModel } from "./friends-state.js";

// The headings and lines of this page; the ones marked [confirm] are drafted, because design section 7 does not give them.
const FRIENDS_HEADING = "Your friends"; // [confirm]
const REQUESTS_HEADING = "Requests";
const SENT_REQUESTS_HEADING = "Requests you sent";
const WAITING_LINE = "Waiting for an answer";
const COPIES_HEADING = "Answers your Meety gave";
const SENT_HEADING = "Asks you sent"; // [confirm]
const ASK_BUTTON_LABEL = "Ask their Meety";
const MEET_LABEL = "Meet";
const SEND_LABEL = "Send the ask"; // [confirm]
const NO_FRIENDS_TITLE = "No friends yet";
const NO_FRIENDS_LINE = "Find people in Explore and add them, or share your invite link.";
const NO_FRIENDS_ACTION = "Find people in Explore";
const NO_COPIES_TITLE = "No answers yet"; // [confirm]
const NO_COPIES_LINE = "Your Meety has not answered anyone yet."; // [confirm]
const NO_SENT_TITLE = "Nothing sent yet"; // [confirm]
const NO_SENT_LINE = "Ask a friend how they would react, or ask Meety who could help."; // [confirm]
const LOADING_FRIENDS_LINE = "Loading your friends."; // [confirm]
const LOADING_COPIES_LINE = "Loading the answers your Meety gave."; // [confirm]
const COPY_ANSWER_LABEL = "Your Meety's answer"; // [confirm]
// The name on the caller's own persona bubble, so its initial reads Y [confirm].
const SELF_NAME = "You"; // [confirm]
// The words for where each sent ask is, and its kind [confirm].
const SENT_STATE_LINES: Record<AskSummary["state"], string> = { checking: "Still running", asking: "Still running", ranking: "Still running", done: "Answered", refused: "Not allowed", failed: "Could not finish" }; // [confirm]
const SENT_MODE_LINES: Record<AskSummary["mode"], string> = { react: "Friend ask", help: "Help search" }; // [confirm]
// The most characters the ask box takes, the upper bound of AskCreate.
const ASK_MAX_CHARACTERS = 300;

// The line for a friend who has not turned on friend asks, in the same words as the API's friend_asks_off sentence (design section 6).
function asksOffLine(friend: Friend): string {
  return `${friend.displayName} has not turned on friend asks.`;
}

// The label of one friend's ask box; 5 to 300 characters is what AskCreate accepts after trimming [confirm].
function askBoxLabel(friend: Friend): string {
  return `What should ${friend.displayName} react to?`;
}

// The line that opens one copy: who asked and what, by the kind of ask [confirm].
function askedLine(copy: AboutMeAnswer): string {
  if (copy.mode === "react") return `${copy.askerName} asked how you would probably react to: ${copy.text}`;
  return `${copy.askerName} asked people in Explore for help: ${copy.text}`;
}

// A person's name in a row: a link to their profile when they are in Explore, else plain.
const PersonName = (props: { name: string; listingId: string | null }): ReactElement => {
  const name = <strong className="friends-name">{props.name}</strong>;
  if (props.listingId === null) return name;
  return <Link className="friends-name-link" to={APP_PATHS.person(props.listingId)}>{name}</Link>;
};

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

// What one friend's row offers: Ask their agent (or the line that their friend asks are off) and Meet, then the open ask box with
// its errors under the friend (P3).
const FriendAction = (props: { friend: Friend; model: FriendsScreenModel }): ReactElement => {
  const { friend, model } = props;
  const isChosen = model.chosenPairId === friend.pairId;
  const meetTo = friend.listingId === null ? APP_PATHS.lobby(friend.pairId) : APP_PATHS.person(friend.listingId);
  return (
    <div className="friends-action">
      <div className="friends-buttons">
        {friend.canAsk ? (
          <button type="button" className="quiet" aria-expanded={isChosen} onClick={() => { model.choose(friend.pairId); }}>
            {ASK_BUTTON_LABEL}
          </button>
        ) : (
          <p className="muted friends-off">{asksOffLine(friend)}</p>
        )}
        <Link className="btn quiet" to={meetTo} aria-label={`${MEET_LABEL} ${friend.displayName}`}>{MEET_LABEL}</Link>
      </div>
      {isChosen && friend.canAsk ? (
        <>
          <ReactAskForm friend={friend} isSending={model.isSending} onSend={(text) => { void model.sendReactAsk(friend.pairId, text); }} />
          {model.formLine === null ? null : <p className="friends-form-line" role="alert">{model.formLine}</p>}
          {model.sendError === null ? null : <ErrorNotice error={model.sendError} />}
        </>
      ) : null}
    </div>
  );
};

// The friends part: loading, an error, nobody yet, or one row per friend in the order the server gives (most recently joined first).
const FriendsBody = (props: { model: FriendsScreenModel }): ReactElement => {
  const { friends } = props.model;
  if (friends.value === null) return friends.error === null ? <LoadingLine text={LOADING_FRIENDS_LINE} /> : <ErrorNotice error={friends.error} />;
  if (friends.value.friends.length === 0) {
    const action = <Link className="btn" to={APP_PATHS.explore}>{NO_FRIENDS_ACTION}</Link>;
    return <EmptyState sticker="smile" title={NO_FRIENDS_TITLE} action={action}>{NO_FRIENDS_LINE}</EmptyState>;
  }
  return (
    <ul className="friends-list">
      {friends.value.friends.map((friend) => (
        <li className="friends-row" key={friend.pairId}>
          <PersonAvatar name={friend.displayName} photo={friend.photo} isSample={friend.isSample} />
          <PersonName name={friend.displayName} listingId={friend.listingId} />
          <FriendAction friend={friend} model={props.model} />
        </li>
      ))}
    </ul>
  );
};

// The incoming requests, first on the page and only when there are some: each with Accept (the main action) and Decline.
const RequestsSection = (props: { model: FriendsScreenModel; incoming: FriendRequestView[] }): ReactElement | null => {
  const { model } = props;
  if (props.incoming.length === 0) return null;
  return (
    <section className="friends-requests">
      <h2>{REQUESTS_HEADING}</h2>
      <ul className="friends-list">
        {props.incoming.map((request) => (
          <li className="friends-row is-request" key={request.requestId}>
            <PersonAvatar name={request.otherName} />
            <PersonName name={request.otherName} listingId={request.otherListingId} />
            <div className="friends-buttons">
              <button type="button" disabled={model.answer.busyId === request.requestId} onClick={() => void model.accept(request.requestId)}>Accept</button>
              <button type="button" className="quiet" disabled={model.answer.busyId === request.requestId} onClick={() => void model.decline(request.requestId)}>Decline</button>
            </div>
          </li>
        ))}
      </ul>
      {model.answer.error === null ? null : <ErrorNotice error={model.answer.error} />}
    </section>
  );
};

// The requests you sent that are still waiting, after your friends and only when there are some.
const SentRequestsSection = (props: { outgoing: FriendRequestView[] }): ReactElement | null => {
  if (props.outgoing.length === 0) return null;
  return (
    <section>
      <h2>{SENT_REQUESTS_HEADING}</h2>
      <ul className="friends-waiting">
        {props.outgoing.map((request) => (
          <li key={request.requestId}>
            <PersonAvatar name={request.otherName} size="s" />
            <PersonName name={request.otherName} listingId={request.otherListingId} />
            <span className="muted">{WAITING_LINE}</span>
          </li>
        ))}
      </ul>
    </section>
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

// The /friends page: requests to answer, your friends with Ask their agent and Meet, the requests you sent, then the answers your
// persona gave and the asks you sent (wave 7). On a laptop the people sit beside the answers.
export const FriendsScreen = (): ReactElement => {
  const navigate = useNavigate();
  const model = useFriendsScreen((path) => {
    navigate(path);
  });
  const requests = model.requests.value;
  return (
    <ScreenFrame title="Friends" isWide>
      <div className="friends-columns">
        <div className="friends-side">
          <RequestsSection model={model} incoming={requests?.incoming ?? []} />
          <section>
            <h2>{FRIENDS_HEADING}</h2>
            <FriendsBody model={model} />
          </section>
          <SentRequestsSection outgoing={requests?.outgoing ?? []} />
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
