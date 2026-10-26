import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import { APP_PATHS, CopyButton, ScreenFrame } from "../../app-shell/index.js";
import { useConsentState, type ConsentState } from "./share-state.js";

// The explainer above the consent button, word for word (4.7).
const CONSENT_EXPLAINER = "Publishing makes a page anyone with the link can read. It shows your display names, the question, the card items you approved, what the two personas said, and the brief lines that passed the support check with their quotes. It never shows your archive, redacted text, quiz answers or anything you did not approve. Either of you can take it down at any time; the page disappears on the next visit.";
// The words shown while the briefs are not written yet (4.7).
const CLOSED_TEXT = "Consent opens when both briefs are written.";
// The words shown after this person consented and the other has not yet (4.7).
const WAITING_TEXT = "You have consented. Waiting for the other person.";
// The words shown once the page is live (4.7).
const PUBLISHED_TEXT = "Published. Anyone with the link can read it.";

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
      <button type="button" style={{ minHeight: 44 }} onClick={props.onWithdraw}>
        Take the page down
      </button>
    );
  }
  return (
    <button type="button" style={{ minHeight: 44 }} onClick={props.onConsent}>
      I consent to publish
    </button>
  );
};

// The share link and its copy button, shown only while the page is live.
const ShareLink = (props: { state: ConsentState }): ReactElement | null => {
  const url = shareUrlOf(props.state);
  if (url === null) return null;
  return (
    <div>
      <p>{url}</p>
      <CopyButton text={url} label="Copy link" />
    </div>
  );
};

// The member's consent screen for one meeting: the explainer, the status, the one button, and the link once it is live.
export const ConsentScreen = (): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const share = useConsentState(meetingId);
  const statusText = statusTextOf(share);
  return (
    <ScreenFrame title="Share this meeting">
      <p>{CONSENT_EXPLAINER}</p>
      {statusText === null ? null : <p>{statusText}</p>}
      {share.kind === "error" ? (
        <div className="notice" role="alert">
          <p>{share.message}</p>
        </div>
      ) : null}
      <ConsentButton state={share} onConsent={() => void share.consent()} onWithdraw={() => void share.withdraw()} />
      <ShareLink state={share} />
    </ScreenFrame>
  );
};
