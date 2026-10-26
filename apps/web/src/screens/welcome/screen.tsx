import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { APP_PATHS, ScreenFrame } from "../../app-shell/index.js";
import { RecoverForm, WelcomeForm } from "./welcome-forms.js";

// The start page: create a profile, or come back with a recovery code (A5).
export const WelcomeScreen = (): ReactElement => {
  const navigate = useNavigate();
  const goToUpload = (): void => {
    navigate(APP_PATHS.upload, { replace: true });
  };
  return (
    <ScreenFrame title="Meet First">
      <p>Your AI agent meets theirs first. With receipts.</p>
      <p className="muted">Meet First is for adults, 18 and over.</p>
      <WelcomeForm onDone={goToUpload} />
      <RecoverForm onDone={goToUpload} />
      <p className="muted">
        Already set up on this browser? <Link to={APP_PATHS.upload}>Add your notes</Link>
      </p>
    </ScreenFrame>
  );
};
