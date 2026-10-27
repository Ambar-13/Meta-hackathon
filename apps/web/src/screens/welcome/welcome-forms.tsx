import { useEffect, type FormEvent, type ReactElement } from "react";
import { ErrorNotice, CopyButton } from "../../app-shell/index.js";
import { Sticker } from "../../look/index.js";
import { useCreatePerson, useRecover } from "./welcome-state.js";

// The recovery code, shown once, with a copy action and the save sentence (A5).
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
// and onDone runs when the person continues (A5).
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
      <button type="submit" className="big" disabled={isSending}>
        Create my profile
      </button>
      <GroupsField />
      {state.kind === "invalid" ? <p role="alert" className="notice">{state.message}</p> : null}
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
