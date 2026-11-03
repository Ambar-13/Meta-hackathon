import { useEffect, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { APP_PATHS, ErrorNotice, lobbyPathWithCard, readApprovedCard, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, LoadingLine, Sticker } from "../../look/index.js";
import { WelcomeForm } from "../welcome/index.js";
import { useJoinPair } from "./pair-state.js";

// The /join page an invite link opens: accept the invite, creating a profile first when there is none (D32, R9.2, R9.3).
export const JoinScreen = (): ReactElement => {
  const navigate = useNavigate();
  const { state, join, profileCreated } = useJoinPair();
  const joinedPairId = state.kind === "joined" ? state.pairId : null;
  useEffect(() => {
    if (joinedPairId !== null) navigate(lobbyPathWithCard(joinedPairId, readApprovedCard()), { replace: true });
  }, [joinedPairId, navigate]);
  return (
    <ScreenFrame title="Accept an invite">
      {state.kind === "missing" ? (
        <EmptyState sticker="nope" title="This link does not work" action={<Link className="btn quiet" to={APP_PATHS.welcome}>Go to the start page</Link>}>
          This invite link is not complete. Ask for a new invite.
        </EmptyState>
      ) : null}
      {state.kind === "ready" || state.kind === "sending" ? (
        <section className="join-card">
          <Sticker name="tags" className="join-sticker" />
          <p className="pair-lead">You were invited to let your agents meet first.</p>
          <div className="actions">
            <button type="button" className="big" disabled={state.kind === "sending"} onClick={() => void join()}>
              Accept the invite
            </button>
          </div>
          {state.kind === "sending" ? <LoadingLine text="Accepting the invite." /> : null}
        </section>
      ) : null}
      {state.kind === "needs_profile" ? (
        <>
          <p className="pair-lead">Create your profile first. The invite is accepted right after.</p>
          <WelcomeForm onDone={profileCreated} />
        </>
      ) : null}
      {state.kind === "failed" ? (
        <>
          <ErrorNotice error={state.error} />
          <div className="actions">
            <Link className="btn" to={APP_PATHS.home}>Go to Home</Link>
          </div>
        </>
      ) : null}
      <p className="muted join-foot">
        Opened inside another app? Move this profile to Safari from <Link to={APP_PATHS.settings}>Settings</Link>.
      </p>
    </ScreenFrame>
  );
};
