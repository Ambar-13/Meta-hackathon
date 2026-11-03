import { useEffect, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { useClaim } from "./welcome-state.js";

// Opens a profile in this browser from a one-time transfer link.
export const ClaimScreen = (): ReactElement => {
  const navigate = useNavigate();
  const { state, claim } = useClaim();
  const isDone = state.kind === "done";
  useEffect(() => {
    if (isDone) navigate(APP_PATHS.upload, { replace: true });
  }, [isDone, navigate]);
  return (
    <ScreenFrame title="Move your profile here">
      {state.kind === "missing" ? <p>This link is not complete. Make a new one in Settings on your other browser.</p> : null}
      {state.kind === "ready" || state.kind === "sending" ? (
        <>
          <p>This link moves your profile into this browser. It works once.</p>
          <button type="button" disabled={state.kind === "sending"} onClick={() => void claim()}>
            Use this link
          </button>
        </>
      ) : null}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
    </ScreenFrame>
  );
};
