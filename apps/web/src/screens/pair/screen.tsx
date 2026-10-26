import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { ErrorNotice, lobbyPathWithCard, readApprovedCard, readCardQuery, ScreenFrame, CopyButton } from "../../app-shell/index.js";
import { qrPathFor, useCreatePair } from "./pair-state.js";

// The /pair page: make an invite and show it as a QR code and a link (D32).
export const PairScreen = (): ReactElement => {
  const location = useLocation();
  const cardId = readCardQuery(location.search) ?? readApprovedCard();
  const { state, create } = useCreatePair();
  const isSending = state.kind === "sending";
  return (
    <ScreenFrame title="Pair with someone">
      {state.kind === "created" ? null : <p>Make an invite for the person you want to meet. Show them the QR code or send them the link.</p>}
      {state.kind === "created" ? <InviteView inviteUrl={state.pair.inviteUrl} pairId={state.pair.pairId} cardId={cardId} /> : null}
      {state.kind === "created" ? null : (
        <button type="button" disabled={isSending} onClick={() => void create()}>
          Make an invite
        </button>
      )}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
      {cardId === null && state.kind === "created" ? (
        <p className="muted">You can pair now. To start a meeting from this phone, approve your card first.</p>
      ) : null}
    </ScreenFrame>
  );
};

// The invite as a QR code, a read-only link with a copy action, and the way to the lobby.
const InviteView = (props: { inviteUrl: string; pairId: string; cardId: string | null }): ReactElement => {
  const { path, size } = qrPathFor(props.inviteUrl);
  return (
    <>
      <div className="qr">
        <svg role="img" aria-label="QR code of the invite link" shapeRendering="crispEdges" viewBox={`0 0 ${String(size)} ${String(size)}`}>
          <rect width={size} height={size} fill="#ffffff" />
          <path d={path} fill="#1f2328" />
        </svg>
      </div>
      <label>
        Invite link
        <input type="text" readOnly value={props.inviteUrl} />
      </label>
      <CopyButton text={props.inviteUrl} label="Copy link" />
      <p className="muted">The invite works once, for 24 hours.</p>
      <Link to={lobbyPathWithCard(props.pairId, props.cardId)}>Go to the lobby</Link>
    </>
  );
};
