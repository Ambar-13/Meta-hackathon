import "./share.css";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { APP_PATHS, CopyButton, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, LoadingLine, Sticker } from "../../look/index.js";
import { PublishPreviewPanel } from "./preview.js";
import { useConsentState, usePublishPreview, type ConsentState } from "./share-state.js";

// The explainer above the consent button, word for word.
const CONSENT_EXPLAINER =
  "Publishing makes a page anyone with the link can read. It shows your display names, the question, the card items you approved, what the two Meetys said, and the brief lines that passed the support check with their quotes. It never shows your archive, redacted text, quiz answers or anything you did not approve. Either of you can take it down at any time; the page disappears on the next visit.";
// The words shown while the briefs are not written yet.
const CLOSED_TEXT = "Consent opens when both briefs are written.";
// The words shown after this person consented and the other has not yet.
const WAITING_TEXT = "You have consented. Waiting for the other person.";
// The words shown once the page is live.
const PUBLISHED_TEXT = "Published. Anyone with the link can read it.";
// The words of the consent screen.
const CONSENT_COPY = {
  loading: "Reading the meeting.",
  closedTitle: "Not ready to share yet",
  backToMeeting: "Back to the meeting",
  liveTitle: "Your page is live",
} as const;

// Whether this person has consented, from the open state; false in every other state.
function isMineConsented(state: ConsentState): boolean {
  if (state.kind !== "open") return false;
  return state.mySide === "a" ? state.consentA : state.consentB;
}

// The line under the explainer that says where consent stands for this person.
function statusTextOf(state: ConsentState): string | null {
  if (state.kind === "closed") return CLOSED_TEXT;
  if (state.kind !== "open") return null;
  if (state.published) return PUBLISHED_TEXT;
  return isMineConsented(state) ? WAITING_TEXT : null;
}

// The share URL of a live page, built on this origin, or null while there is no page.
function shareUrlOf(state: ConsentState): string | null {
  if (state.kind !== "open" || !state.published || state.slug === undefined) return null;
  return `${window.location.origin}${APP_PATHS.sharePage(state.slug)}`;
}

// Props of the consent and withdraw button: the state and the two actions the hook gives.
type ActionProps = { state: ConsentState; onConsent: () => void; onWithdraw: () => void };

// The one button this person can press: consent when they have not, take the page down when they have.
const ConsentButton = (props: ActionProps): ReactElement | null => {
  if (props.state.kind !== "open") return null;
  if (isMineConsented(props.state)) {
    return (
      <button type="button" className="quiet" onClick={props.onWithdraw}>
        Take the page down
      </button>
    );
  }
  return (
    <button type="button" className="big" onClick={props.onConsent}>
      I consent to publish
    </button>
  );
};

// The share link and its copy button, shown only while the page is live.
const ShareLink = (props: { state: ConsentState }): ReactElement | null => {
  const url = shareUrlOf(props.state);
  if (url === null) return null;
  return (
    <section className="share-live" aria-labelledby="share-live-title">
      <Sticker name="check" className="share-live-sticker" />
      <h2 id="share-live-title">{CONSENT_COPY.liveTitle}</h2>
      <p className="share-url">{url}</p>
      <CopyButton text={url} label="Copy link" />
    </section>
  );
};

// The closed face: the briefs are not written yet, so there is nothing to consent to; the way on is the meeting itself.
const ClosedState = (props: { meetingId: string }): ReactElement => {
  return (
    <EmptyState
      sticker="cup"
      title={CONSENT_COPY.closedTitle}
      action={
        <Link className="btn quiet" to={APP_PATHS.meeting(props.meetingId)}>
          {CONSENT_COPY.backToMeeting}
        </Link>
      }
    >
      {CLOSED_TEXT}
    </EmptyState>
  );
};

// The member's consent screen for one meeting: the live link once there is one, the preview of the page, the explainer, then the
// status and the one button, kept in reach at the bottom of the screen.
export const ConsentScreen = (): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const share = useConsentState(meetingId);
  const preview = usePublishPreview(meetingId);
  const statusText = statusTextOf(share);
  return (
    <ScreenFrame title="Share this meeting">
      {share.kind === "loading" ? <LoadingLine text={CONSENT_COPY.loading} /> : null}
      {share.kind === "error" ? (
        <div className="notice" role="alert">
          <p>{share.message}</p>
        </div>
      ) : null}
      {share.kind === "closed" ? <ClosedState meetingId={meetingId} /> : null}
      <ShareLink state={share} />
      {share.kind === "open" ? <PublishPreviewPanel preview={preview} /> : null}
      <p className="share-explainer">{CONSENT_EXPLAINER}</p>
      {share.kind === "open" ? (
        <div className="share-dock">
          {statusText === null ? null : <p className="share-status">{statusText}</p>}
          <ConsentButton
            state={share}
            onConsent={() => void share.consent()}
            onWithdraw={() => void share.withdraw()}
          />
        </div>
      ) : null}
    </ScreenFrame>
  );
};
