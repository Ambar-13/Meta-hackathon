import type { ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CardView } from "@meet-first/contracts";
import { elapsedSeconds, ErrorNotice, pairPathWithCard, ScreenFrame } from "../../app-shell/index.js";
import { CardItemList, RecallSwitch } from "./card-items.js";
import { useCardScreen, type CardActionState } from "./card-state.js";
import { SharingSection } from "./sharing-section.js";

// The page while the card builds: the seconds so far, counted on the server clock (R3.4).
const BuildingBody = (props: { seconds: number }): ReactElement => {
  return <p>{`Building your card. ${String(props.seconds)} s so far.`}</p>;
};

// The page when the card failed, with the way to build it again.
const FailedBody = (props: { action: CardActionState; onRebuild: () => void }): ReactElement => {
  return (
    <>
      <p>The card could not be built.</p>
      <button type="button" disabled={props.action.kind === "sending"} onClick={props.onRebuild}>
        Build it again
      </button>
      {props.action.kind === "failed" ? <ErrorNotice error={props.action.error} /> : null}
    </>
  );
};

// The approve box and its hint, shown until the card is approved.
const ApproveBody = (props: { isNothingTicked: boolean; isSending: boolean; onApprove: () => void }): ReactElement => {
  return (
    <>
      {props.isNothingTicked ? <p className="muted">Tick at least one item to approve your card.</p> : null}
      <button type="button" disabled={props.isNothingTicked || props.isSending} onClick={props.onApprove}>
        Approve my card
      </button>
    </>
  );
};

// The approved state: the quiz button (left out for a thin card), the link to pair, and the Sharing section (design section 7).
const ApprovedBody = (props: { card: CardView; isSending: boolean; onQuiz: () => void }): ReactElement => {
  return (
    <>
      <p>Card approved.</p>
      {props.card.thin ? null : (
        <button type="button" disabled={props.isSending} onClick={props.onQuiz}>
          Take the knows-me quiz
        </button>
      )}
      <Link to={pairPathWithCard(props.card.id)}>Pair with someone</Link>
      <SharingSection cardId={props.card.id} items={props.card.items} />
    </>
  );
};

// The notice on a thin card: fewer than 6 items had a quote that checked out (D23).
const ThinNote = (props: { isThin: boolean }): ReactElement | null => {
  if (!props.isThin) return null;
  return <p className="notice">Thin card: fewer than 6 items had a quote that checked out. Meetings still work; the quiz is skipped.</p>;
};

// The card page: watch it build, read and approve items, set the recall switch, then quiz, pair or choose what to share (R3.4, R7.1, D23, design section 7).
export const CardScreen = (): ReactElement => {
  const navigate = useNavigate();
  const cardId = useParams()["cardId"] ?? "";
  const screen = useCardScreen(cardId, (path) => {
    navigate(path);
  });
  const { polled, firstServerNow, ticked, action } = screen;
  const card = polled.value;
  if (card === null) {
    return <ScreenFrame title="Your card">{polled.error === null ? <p>Loading your card.</p> : <ErrorNotice error={polled.error} />}</ScreenFrame>;
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
  const isApproved = card.state === "approved";
  return (
    <ScreenFrame title="Your card">
      <ThinNote isThin={card.thin} />
      <CardItemList cardId={cardId} items={card.items} ticked={ticked} isLocked={isApproved} onToggle={screen.toggleItem} />
      <RecallSwitch isOn={isApproved ? card.recallAllowed : screen.isRecallAllowed} isLocked={isApproved} onChange={screen.setRecallAllowed} />
      {isApproved ? (
        <ApprovedBody card={card} isSending={action.kind === "sending"} onQuiz={() => void screen.startQuiz()} />
      ) : (
        <ApproveBody isNothingTicked={ticked.size === 0} isSending={action.kind === "sending"} onApprove={() => void screen.approveCard()} />
      )}
      {action.kind === "failed" ? <ErrorNotice error={action.error} /> : null}
    </ScreenFrame>
  );
};
