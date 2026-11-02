import "./pair.css";
import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { ErrorNotice, lobbyPathWithCard, readApprovedCard, readCardQuery, ScreenFrame, CopyButton } from "../../app-shell/index.js";
import { LoadingLine, NameTag } from "../../look/index.js";
import { readAccessCode, withAccessCode } from "../welcome/index.js";
import { qrPathFor, useCreatePair } from "./pair-state.js";

// Two name tags side by side: yours in coral and an empty one in blue for the person you invite.
const PairTags = (props: { otherName: string }): ReactElement => {
  return (
    <div className="pair-tags" aria-hidden="true">
      <NameTag name="you" colour="coral" className="pair-tag-a" />
      <span className="pair-and">&amp;</span>
      <NameTag name={props.otherName} colour="blue" className="pair-tag-b" />
    </div>
  );
};

// The /pair page: make an invite and show it as a QR code and a link (D32).
export const PairScreen = (): ReactElement => {
  const location = useLocation();
  const cardId = readCardQuery(location.search) ?? readApprovedCard();
  const { state, create } = useCreatePair();
  const isSending = state.kind === "sending";
  return (
    <ScreenFrame title="Pair with someone">
      {state.kind === "created" ? (
        <>
          <InviteView inviteUrl={state.pair.inviteUrl} pairId={state.pair.pairId} cardId={cardId} />
          <p className="soft-panel invite-wait">When they accept, you both show up in the lobby.</p>
        </>
      ) : null}
      {state.kind === "created" ? null : (
        <>
          <PairTags otherName="them" />
          <p className="pair-lead">Make an invite for the person you want to meet. Show them the QR code or send them the link.</p>
          <div className="actions">
            <button type="button" className="big" disabled={isSending} onClick={() => void create()}>
              Make an invite
            </button>
          </div>
          {isSending ? <LoadingLine text="Making your invite." /> : null}
        </>
      )}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
      {cardId === null && state.kind === "created" ? (
        <p className="muted">You can pair now. To start a meeting from this phone, approve your card first.</p>
      ) : null}
    </ScreenFrame>
  );
};

// The invite on a white card: the QR code, a read-only link with a copy action, and the way to the lobby. The link carries
// this browser's access code, so the friend who opens it never types it (R9.5).
const InviteView = (props: { inviteUrl: string; pairId: string; cardId: string | null }): ReactElement => {
  const link = withAccessCode(props.inviteUrl, readAccessCode());
  const { path, size } = qrPathFor(link);
  return (
    <section className="panel invite-card" aria-label="Your invite">
      <div className="qr invite-qr">
        <svg role="img" aria-label="QR code of the invite link" shapeRendering="crispEdges" viewBox={`0 0 ${String(size)} ${String(size)}`}>
          <rect className="qr-paper" width={size} height={size} />
          <path className="qr-ink" d={path} />
        </svg>
      </div>
      <div className="invite-body">
        <label>
          Invite link
          <input type="text" readOnly value={link} />
        </label>
        <p className="muted">The invite works once, for 24 hours.</p>
        <div className="actions">
          <Link className="btn" to={lobbyPathWithCard(props.pairId, props.cardId)}>
            Go to the lobby
          </Link>
          <CopyButton text={link} label="Copy link" />
        </div>
      </div>
    </section>
  );
};
