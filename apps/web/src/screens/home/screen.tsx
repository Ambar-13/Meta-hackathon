import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { HomeCard, HomeView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { Avatar, EmptyState, KIND_LOOK, LoadingLine, NameTag, Sticker } from "../../look/index.js";
import {
  ITEM_KIND_COLOUR,
  meetingLink,
  meetingStateWords,
  nextStepOf,
  shortDay,
  useHomeView,
} from "./home-state.js";
import "./home.css";

// The one next step, on a tilted blue panel with its sticker: the main link, and a second one when there is a real choice.
export const NextStepPanel = (props: { home: HomeView }): ReactElement => {
  const step = nextStepOf(props.home);
  return (
    <section className="colour-panel c-blue home-next" aria-labelledby="home-next-title">
      <Sticker name={step.sticker} />
      <span className="pill">
        <span className="dot" />
        Your next step
      </span>
      <h2 id="home-next-title">{step.title}</h2>
      <p>{step.text}</p>
      <div className="actions">
        <Link className="btn quiet" to={step.action.to}>
          {step.action.label}
        </Link>
        {step.second === undefined ? null : <Link to={step.second.to}>{step.second.label}</Link>}
      </div>
    </section>
  );
};

// The person's card as their own name tag: the band, their name written on it, their first items and one quote.
const CardTag = (props: { card: HomeCard; name: string }): ReactElement => {
  const first = props.card.items[0];
  return (
    <Link
      className="home-card"
      to={APP_PATHS.card(props.card.id)}
      aria-label={`Your card, ${String(props.card.itemCount)} items`}
    >
      <span className="home-card-band" aria-hidden="true">
        <b />
        <i />
      </span>
      <span className="home-card-name">{props.name}</span>
      {props.card.items.length === 0 ? null : (
        <span className="home-card-items">
          {props.card.items.map((item) => (
            <span key={item.claim} className={`home-item ${ITEM_KIND_COLOUR[item.kind]}`}>
              {item.claim}
            </span>
          ))}
        </span>
      )}
      {first === undefined ? null : <q className="home-card-quote">{first.quote}</q>}
    </Link>
  );
};

// The card section: the tag when there is a card, a short line when there is not.
export const CardSection = (props: { home: HomeView }): ReactElement => {
  const { card } = props.home;
  return (
    <section aria-labelledby="home-card-title">
      <div className="home-h2row">
        <h2 id="home-card-title">Your card</h2>
        {card === null ? null : <Link to={APP_PATHS.card(card.id)}>See it all</Link>}
      </div>
      {card === null ? (
        <p className="muted">
          Your card appears here once your notes are in and the names are checked.
        </p>
      ) : (
        <CardTag card={card} name={props.home.displayName} />
      )}
    </section>
  );
};

// Every meeting, newest first, each with the other person, the question, where it is and when.
export const MeetingsSection = (props: { home: HomeView }): ReactElement => {
  const { meetings, serverNow } = props.home;
  return (
    <section aria-labelledby="home-meetings-title">
      <h2 id="home-meetings-title">Meetings</h2>
      {meetings.length === 0 ? (
        <EmptyState sticker="chat" title="No meetings yet">
          Your first one starts from an invite or Explore.
        </EmptyState>
      ) : (
        <ul className="home-rows">
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <Link
                className={`home-row ${KIND_LOOK[meeting.questionKind].colour}`}
                to={meetingLink(meeting)}
              >
                <Avatar name={meeting.otherDisplayName} side="b" />
                <span>
                  <b>{`With ${meeting.otherDisplayName}: ${meeting.questionText}`}</b>
                  <small>
                    <span className="pill">
                      <span className="dot" />
                      {meetingStateWords(meeting)}
                    </span>
                    {shortDay(meeting.createdAt, serverNow)}
                  </small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// The pairs still open, each a way back to its lobby; nothing shows when there are none.
export const PairsSection = (props: { home: HomeView }): ReactElement | null => {
  if (props.home.pairs.length === 0) return null;
  return (
    <section aria-labelledby="home-pairs-title">
      <h2 id="home-pairs-title">Open invites</h2>
      <ul className="home-rows">
        {props.home.pairs.map((pair) => (
          <li key={pair.id}>
            <Link className="home-row c-yellow" to={APP_PATHS.lobby(pair.id)}>
              <Sticker name="tags" />
              <span>
                <b>
                  {pair.otherDisplayName === null
                    ? "Waiting for someone to join"
                    : `With ${pair.otherDisplayName}`}
                </b>
                <small>{`Open until ${shortDay(pair.expiresAt, props.home.serverNow)}`}</small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

// The home screen: hello with your own name tag, the one next step, your card, your meetings and your open invites (design pass fix 4).
export const HomeScreen = (): ReactElement => {
  const home = useHomeView();
  const value = home.value;
  return (
    <ScreenFrame
      title="Hello,"
      titleAside={
        value === null ? undefined : <NameTag name={value.displayName} className="home-hello-tag" />
      }
    >
      {value === null && home.error === null ? <LoadingLine text="Opening your home." /> : null}
      {home.error === null ? null : <ErrorNotice error={home.error} />}
      {value === null ? null : (
        <>
          <NextStepPanel home={value} />
          <CardSection home={value} />
          <MeetingsSection home={value} />
          <PairsSection home={value} />
        </>
      )}
    </ScreenFrame>
  );
};
