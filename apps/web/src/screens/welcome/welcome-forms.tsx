import { useEffect, type FormEvent, type ReactElement } from "react";
import { ErrorNotice, CopyButton } from "../../app-shell/index.js";
import { useCreatePerson, useRecover } from "./welcome-state.js";

// The recovery code, shown once, with a copy action and the save sentence (A5).
export const RecoveryCodePanel = (props: { code: string; onContinue: () => void }): ReactElement => {
  return (
    <section className="panel" aria-labelledby="recovery-heading">
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

// The create-profile form; after creating it shows the recovery code once, and onDone runs when the person continues (A5).
export const WelcomeForm = (props: { onDone: () => void }): ReactElement => {
  const { state, create, forgetCode } = useCreatePerson();
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
    void create(String(form.get("displayName") ?? ""), String(form.get("groups") ?? ""));
  };
  return (
    <form onSubmit={onSubmit}>
      <fieldset>
        <legend>Create your profile</legend>
        <label>
          Your display name
          <input type="text" name="displayName" maxLength={80} required autoComplete="off" />
        </label>
        <label>
          Groups you belong to (optional)
          <input type="text" name="groups" autoComplete="off" />
        </label>
        <p className="muted">Separate names with commas. These names are never hidden from your notes.</p>
        <button type="submit" disabled={isSending}>
          Create my profile
        </button>
      </fieldset>
      {state.kind === "invalid" ? <p role="alert">{state.message}</p> : null}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
    </form>
  );
};

// The form that redeems a recovery code; onDone runs after the server accepts it (A5).
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
    <form onSubmit={onSubmit}>
      <fieldset>
        <legend>Have a recovery code?</legend>
        <label>
          Recovery code
          <input type="text" name="code" maxLength={32} autoComplete="off" />
        </label>
        <button type="submit" disabled={state.kind === "sending"}>
          Sign in with the code
        </button>
      </fieldset>
      {state.kind === "invalid" ? <p role="alert">{state.message}</p> : null}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
    </form>
  );
};
