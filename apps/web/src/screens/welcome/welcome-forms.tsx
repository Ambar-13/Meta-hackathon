import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { ErrorNotice, CopyButton, routes } from "../../app-shell/index.js";
import { Sticker } from "../../look/index.js";
import { accessCodeIn } from "./access-code.js";
import { googleResultIn, useCreatePerson, useGoogleSignIn, useRecover } from "./welcome-state.js";

// The words of Continue with Google and of a Google sign-in that came back unfinished.
const GOOGLE_COPY = {
  button: "Continue with Google",
  or: "or start with only your name",
  failed: "Google sign-in did not finish. Try again.",
  cancelled: "Google sign-in was cancelled. Try again whenever you like.",
} as const;

// Google's own G, in its own four colours, as Google's sign-in guidelines ask; the one place green shows in the app.
const GoogleMark = (): ReactElement => {
  return (
    <svg className="wl-google-mark" viewBox="0 0 48 48" width="22" height="22" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
};

// Continue with Google, when the site offers it: Google's G and
// the words on a light pill, a plain link to the api, which sends the browser to Google and back signed in; then the line that leads
// to the name tag form. A sign-in that came back unfinished says so above it.
export const GoogleSignIn = (): ReactElement | null => {
  const isOn = useGoogleSignIn();
  const result = googleResultIn(useLocation().search);
  if (!isOn && result === null) return null;
  return (
    <div className="wl-google">
      {result === null ? null : <p className="wl-google-line" role="status">{result === "cancelled" ? GOOGLE_COPY.cancelled : GOOGLE_COPY.failed}</p>}
      {isOn ? (
        <>
          <a className="btn quiet big wl-google-btn" href={routes.people.googleStart.path}>
            <GoogleMark />
            {GOOGLE_COPY.button}
          </a>
          <p className="wl-or">{GOOGLE_COPY.or}</p>
        </>
      ) : null}
    </div>
  );
};

// The server's two codes for a sign-up the site's access code stops.
const ACCESS_CODE_REFUSALS: readonly string[] = ["access_code_needed", "access_code_wrong"];

// The recovery code, shown once, with a copy action and the save sentence.
export const RecoveryCodePanel = (props: { code: string; onContinue: () => void }): ReactElement => {
  return (
    <section className="wl-recovery" aria-labelledby="recovery-heading">
      <Sticker name="spark" />
      <h2 id="recovery-heading">Your recovery code</h2>
      <p className="recovery-code">{props.code}</p>
      <p>Save this code. It is the only way back in if you lose this device.</p>
      <div className="actions">
        <CopyButton text={props.code} label="Copy code" />
        <button type="button" onClick={props.onContinue}>
          I saved it, continue
        </button>
      </div>
    </section>
  );
};

// The groups field, folded away under one line: what it is for, then the field (design pass fix 5).
const GroupsField = (): ReactElement => {
  return (
    <details className="wl-groups">
      <summary>+ Add a club or team (optional)</summary>
      <label>
        Groups you belong to (optional)
        <input type="text" name="groups" autoComplete="off" />
      </label>
      <p className="hint">
        Clubs, teams or groups you are part of, like a robotics club. Separate them with commas. We hide people&apos;s names in your
        chats before anything is sent, but we keep these, so your agent can still talk about them.
      </p>
    </details>
  );
};

// The create-profile form, drawn as a blank name tag you write your name on; after creating it shows the recovery code once,
// and onDone runs when the person continues. The access code field appears only when the link carried a code or the server
// asked for one, so a site without a code shows no extra field.
export const WelcomeForm = (props: { onDone: () => void }): ReactElement => {
  const { state, create, forgetCode } = useCreatePerson();
  const linkCode = accessCodeIn(useLocation().search);
  const isAskedForCode = state.kind === "failed" && ACCESS_CODE_REFUSALS.includes(state.error.code);
  const [isCodeShown, setIsCodeShown] = useState(linkCode !== "");
  useEffect(() => {
    if (isAskedForCode) setIsCodeShown(true);
  }, [isAskedForCode]);
  if (state.kind === "created") {
    const recoveryCode = state.recoveryCode;
    return (
      <RecoveryCodePanel
        code={recoveryCode}
        onContinue={() => {
          forgetCode();
          props.onDone();
        }}
      />
    );
  }
  const isSending = state.kind === "sending";
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void create(String(form.get("displayName") ?? ""), String(form.get("groups") ?? ""), String(form.get("accessCode") ?? ""));
  };
  return (
    <form className="wl-signup" onSubmit={onSubmit}>
      <div className="tag wl-formtag">
        <span className="tag-band" aria-hidden="true">
          <b />
          <i />
        </span>
        <label className="wl-write-label" htmlFor="display-name">
          Your display name
        </label>
        <input id="display-name" className="wl-write" type="text" name="displayName" maxLength={80} required autoComplete="off" placeholder="write it here" />
      </div>
      {isCodeShown ? (
        <label className="wl-access">
          Access code
          <input type="text" name="accessCode" defaultValue={linkCode} maxLength={100} autoComplete="off" />
        </label>
      ) : null}
      <button type="submit" className="big" disabled={isSending}>
        Create my profile
      </button>
      <GroupsField />
      {state.kind === "invalid" ? <p role="alert" className="notice">{state.message}</p> : null}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
    </form>
  );
};

// The form that redeems a recovery code; onDone runs after the server accepts it.
export const RecoverForm = (props: { onDone: () => void }): ReactElement => {
  const { state, recover } = useRecover();
  const { onDone } = props;
  useEffect(() => {
    if (state.kind === "done") onDone();
  }, [state.kind, onDone]);
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void recover(String(form.get("code") ?? ""));
  };
  return (
    <form className="wl-recover" onSubmit={onSubmit}>
      <label>
        Recovery code
        <input type="text" name="code" maxLength={32} autoComplete="off" />
      </label>
      <button type="submit" className="quiet" disabled={state.kind === "sending"}>
        Sign in with the code
      </button>
      {state.kind === "invalid" ? <p role="alert" className="notice">{state.message}</p> : null}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
    </form>
  );
};
