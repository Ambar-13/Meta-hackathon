import "./card.css";
import type { ReactElement, ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CardView } from "@meet-first/contracts";
import {
  elapsedSeconds,
  ErrorNotice,
  pairPathWithCard,
  readAllowlist,
  ScreenFrame,
} from "../../app-shell/index.js";
import { EmptyState, LoadingLine, NameTag, Sticker } from "../../look/index.js";
import { CardItemList, RecallSwitch } from "./card-items.js";
import { useCardScreen, type CardActionState } from "./card-state.js";
import { SharingSection } from "./sharing-section.js";

// The person's own name tag with one line beside it, when this tab knows the name typed at signup;
// the card itself carries no name.
const CardHello = (props: { children: ReactNode }): ReactElement => {
  const name = readAllowlist()[0] ?? "";
  return (
    <div className="card-hello">
      {name.trim() === "" ? null : <NameTag name={name} className="card-hello-tag" />}
      <p>{props.children}</p>
    </div>
  );
};

// The page while the card builds: the seconds so far, counted on the server clock.
const BuildingBody = (props: { seconds: number }): ReactElement => {
  return (
    <>
      <CardHello>Your Meety is reading your notes and picking a quote for every line.</CardHello>
      <LoadingLine text={`Building your card. ${String(props.seconds)} s so far.`} />
    </>
  );
};

// The page when the card failed, with the way to build it again.
const FailedBody = (props: { action: CardActionState; onRebuild: () => void }): ReactElement => {
  const action = (
    <button type="button" disabled={props.action.kind === "sending"} onClick={props.onRebuild}>
      Build it again
    </button>
  );
  return (
    <>
      <EmptyState sticker="poof" title="The card could not be built." action={action}>
        Your notes are still here. Building again usually works.
      </EmptyState>
      {props.action.kind === "failed" ? <ErrorNotice error={props.action.error} /> : null}
    </>
  );
};

// The approve bar, which stays in view at the bottom until the card is approved, with its hint
// while nothing is ticked.
const ApproveBar = (props: {
  isNothingTicked: boolean;
  isSending: boolean;
  onApprove: () => void;
}): ReactElement => {
  return (
    <div className="approve-bar">
      {props.isNothingTicked ? (
        <p className="approve-hint">Tick at least one item to approve your card.</p>
      ) : null}
      <button
        type="button"
        disabled={props.isNothingTicked || props.isSending}
        onClick={props.onApprove}
      >
        Approve my card
      </button>
    </div>
  );
};

// The approved state's next step: the quiz button (left out for a thin card) and the link to pair.
const ApprovedNext = (props: {
  card: CardView;
  isSending: boolean;
  onQuiz: () => void;
}): ReactElement => {
  return (
    <section className="card-next" aria-labelledby="card-next-title">
      <Sticker name="check" />
      <h2 id="card-next-title">Card approved.</h2>
      <p>Your Meety may now say these things about you, each with its quote.</p>
      <div className="actions">
        {props.card.thin ? null : (
          <button type="button" disabled={props.isSending} onClick={props.onQuiz}>
            Take the knows-me quiz
          </button>
        )}
        <Link
          className={props.card.thin ? "btn" : "btn quiet"}
          to={pairPathWithCard(props.card.id)}
        >
          Invite a friend
        </Link>
      </div>
    </section>
  );
};

// The notice on a thin card: fewer than 6 items had a quote that checked out.
const ThinNote = (props: { isThin: boolean }): ReactElement | null => {
  if (!props.isThin) return null;
  return (
    <p className="thin-note">
      Your card is short: fewer than 6 items had a quote that checked out. Meetings still work; the
      quiz is skipped.
    </p>
  );
};

// A built card: the next step or the hello line, the items, the recall switch, then Sharing once
// approved or the approve bar before.
const CardBody = (props: {
  card: CardView;
  screen: ReturnType<typeof useCardScreen>;
}): ReactElement => {
  const { card, screen } = props;
  const { ticked, action } = screen;
  const isApproved = card.state === "approved";
  return (
    <>
      {isApproved ? (
        <ApprovedNext
          card={card}
          isSending={action.kind === "sending"}
          onQuiz={() => void screen.startQuiz()}
        />
      ) : (
        <CardHello>
          What your Meety learned about you. Keep the lines it may say in meetings.
        </CardHello>
      )}
      <ThinNote isThin={card.thin} />
      <CardItemList
        cardId={card.id}
        items={card.items}
        ticked={ticked}
        isLocked={isApproved}
        onToggle={screen.toggleItem}
      />
      <RecallSwitch
        isOn={isApproved ? card.recallAllowed : screen.isRecallAllowed}
        isLocked={isApproved}
        onChange={screen.setRecallAllowed}
      />
      {action.kind === "failed" ? <ErrorNotice error={action.error} /> : null}
      {isApproved ? (
        <SharingSection cardId={card.id} items={card.items} />
      ) : (
        <ApproveBar
          isNothingTicked={ticked.size === 0}
          isSending={action.kind === "sending"}
          onApprove={() => void screen.approveCard()}
        />
      )}
    </>
  );
};

// The card page: watch it build, read and approve items, set the recall switch, then quiz, pair or
// choose what to share.
export const CardScreen = (): ReactElement => {
  const navigate = useNavigate();
  const cardId = useParams()["cardId"] ?? "";
  const screen = useCardScreen(cardId, (path) => {
    navigate(path);
  });
  const { polled, firstServerNow, action } = screen;
  const card = polled.value;
  if (card === null) {
    return (
      <ScreenFrame title="Your card">
        {polled.error === null ? (
          <LoadingLine text="Loading your card." />
        ) : (
          <ErrorNotice error={polled.error} />
        )}
      </ScreenFrame>
    );
  }
  if (card.state === "building") {
    const seconds = firstServerNow === null ? 0 : elapsedSeconds(firstServerNow, card.serverNow);
    return (
      <ScreenFrame title="Your card">
        <BuildingBody seconds={seconds} />
      </ScreenFrame>
    );
  }
  if (card.state === "failed") {
    return (
      <ScreenFrame title="Your card">
        <FailedBody action={action} onRebuild={() => void screen.rebuild()} />
      </ScreenFrame>
    );
  }
  return (
    <ScreenFrame title="Your card">
      <CardBody card={card} screen={screen} />
    </ScreenFrame>
  );
};
