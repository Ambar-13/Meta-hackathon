// The settings page: the one-time "open in Safari" link and the delete-account flow.
import "./settings.css";
import { useRef, useState, type ReactElement } from "react";
import { type TransferResponse } from "@meet-first/contracts";
import {
  apiFetch,
  asApiError,
  ApiError,
  CopyButton,
  ErrorNotice,
  ScreenFrame,
  routes,
} from "../../app-shell/index.js";
import { LoadingLine, Sticker } from "../../look/index.js";
import { DeleteAccountDialog } from "./delete-account-dialog.js";
import { SESSION_ENDED_CODE, useDeleteAccount, type DeleteFlowState } from "./settings-state.js";

// The transfer link state: idle, sending, created with the link, or failed.
type TransferState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "created"; url: string }
  | { kind: "failed"; error: ApiError };

// The delete section copy and the notice shown after the request is accepted, byte for byte as the
// settings spec gives them.
const SECTION_BODY = "Removes everything we hold about you from our database.";
const DELETED_NOTICE =
  "Your account is being deleted. Everything is removed within a few minutes. You can close this tab.";
// The sentence for a session the server no longer accepts, and the app's general sentence for any
// other failure.
const SESSION_ENDED = "Your session has ended. Open the app again to continue.";
const GENERAL_FAILURE = "The server could not finish this. Try again in a minute.";
// The line while the one-time link is being made.
const MAKING_LINK_LINE = "Making your link.";

// The sentence the dialog shows for a failed delete, or null when nothing failed.
function failureText(flow: DeleteFlowState): string | null {
  if (flow.kind !== "error") return null;
  return flow.code === SESSION_ENDED_CODE ? SESSION_ENDED : GENERAL_FAILURE;
}

// The delete section: the trigger, the dialog while it is open, and the notice once the server
// accepts the request.
const DeleteAccountSection = (): ReactElement => {
  const flow = useDeleteAccount();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const isDialogOpen =
    flow.kind === "confirming" || flow.kind === "deleting" || flow.kind === "error";
  // Closes the dialog and returns the focus to the button that opened it.
  const cancel = (): void => {
    flow.cancel();
    triggerRef.current?.focus();
  };
  return (
    <section className="settings-section" aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading">Delete my account</h2>
      <p>{SECTION_BODY}</p>
      {flow.kind === "deleted" ? (
        <div className="settings-deleted">
          <Sticker name="check" />
          <p role="status">{DELETED_NOTICE}</p>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="quiet settings-delete-trigger"
          onClick={flow.open}
        >
          Delete my account
        </button>
      )}
      {isDialogOpen ? (
        <DeleteAccountDialog
          isBusy={flow.kind === "deleting"}
          errorText={failureText(flow)}
          onCancel={cancel}
          onConfirm={() => void flow.confirm()}
        />
      ) : null}
    </section>
  );
};

// The settings page: the one-time Safari link, then the delete-account section.
export const SettingsScreen = (): ReactElement => {
  const [state, setState] = useState<TransferState>({ kind: "idle" });
  const makeLink = async (): Promise<void> => {
    setState({ kind: "sending" });
    try {
      const reply: TransferResponse = await apiFetch(routes.people.transfer);
      setState({ kind: "created", url: reply.url });
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return (
    <ScreenFrame title="Settings" hideSettingsLink>
      <section className="settings-section" aria-labelledby="transfer-title">
        <h2 id="transfer-title">Open this profile in Safari</h2>
        <p>Opened inside another app? Make a one-time link, then open it in Safari.</p>
        <button
          type="button"
          className="settings-main"
          disabled={state.kind === "sending"}
          onClick={() => void makeLink()}
        >
          Make a Safari link
        </button>
        {state.kind === "sending" ? <LoadingLine text={MAKING_LINK_LINE} /> : null}
        {state.kind === "created" ? (
          <div className="settings-link">
            <label>
              One-time link
              <input type="text" readOnly value={state.url} />
            </label>
            <div className="settings-link-row">
              <CopyButton text={state.url} label="Copy link" />
              <p className="muted">The link works once, for 10 minutes.</p>
            </div>
          </div>
        ) : null}
        {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
      </section>
      <DeleteAccountSection />
    </ScreenFrame>
  );
};
