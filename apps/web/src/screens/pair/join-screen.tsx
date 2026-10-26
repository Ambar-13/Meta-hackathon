import { useEffect, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { APP_PATHS, ErrorNotice, lobbyPathWithCard, readApprovedCard, ScreenFrame } from "../../app-shell/index.js";
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
      {state.kind === "missing" ? <p>This invite link is not complete. Ask for a new invite.</p> : null}
      {state.kind === "ready" || state.kind === "sending" ? (
        <>
          <p>You were invited to let your personas meet first.</p>
          <button type="button" disabled={state.kind === "sending"} onClick={() => void join()}>
            Accept the invite
          </button>
        </>
      ) : null}
      {state.kind === "needs_profile" ? (
        <>
          <p>Create your profile first. The invite is accepted right after.</p>
          <WelcomeForm onDone={profileCreated} />
        </>
      ) : null}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
      <p className="muted">
        Opened inside another app? Move this profile to Safari from <Link to={APP_PATHS.settings}>Settings</Link>.
      </p>
    </ScreenFrame>
  );
};
