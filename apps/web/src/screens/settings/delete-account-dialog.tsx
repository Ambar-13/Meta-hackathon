import { useEffect, useRef, type KeyboardEvent, type ReactElement } from "react";

// The dialog title, byte for byte as the settings spec gives it.
export const DIALOG_TITLE = "Delete everything we hold about you?";
// The dialog body: what the person loses and what the other person keeps.
export const DIALOG_BODY =
  "This deletes your chats, card, meetings, briefs and posts. People you met lose the meetings and briefs you shared. This can't be undone.";
// The line shown while the request is running.
export const DELETING_COPY = "Deleting. This takes a few seconds.";

// The id of the dialog title, which names the dialog for screen readers.
const TITLE_ID = "delete-account-dialog-title";

// The props of the dialog: whether a delete is running, the failure sentence if any, and the two
// actions.
type DeleteAccountDialogProps = {
  isBusy: boolean;
  errorText: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

// The modal dialog that asks before a delete, over a dimmed page. Focus starts on Keep my account,
// Tab stays inside the dialog, and Escape keeps the account. Both buttons are full width; the
// delete one is the coral danger button.
export const DeleteAccountDialog = (props: DeleteAccountDialogProps): ReactElement => {
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);
  // Keeps Tab and Shift+Tab inside the two buttons, and closes the dialog on Escape when no delete
  // is running.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && !props.isBusy) props.onCancel();
    const first = keepRef.current;
    const last = confirmRef.current;
    if (event.key !== "Tab" || first === null || last === null) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="settings-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="panel settings-dialog"
        onKeyDown={onKeyDown}
      >
        <h3 id={TITLE_ID}>{DIALOG_TITLE}</h3>
        <p>{DIALOG_BODY}</p>
        {props.isBusy ? (
          <p className="settings-dialog-line" role="status">
            {DELETING_COPY}
          </p>
        ) : null}
        {props.errorText === null ? null : (
          <p className="settings-dialog-line is-error" role="alert">
            {props.errorText}
          </p>
        )}
        <div className="settings-dialog-actions">
          <button
            ref={keepRef}
            type="button"
            className="quiet"
            disabled={props.isBusy}
            onClick={props.onCancel}
          >
            Keep my account
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="danger"
            disabled={props.isBusy}
            onClick={props.onConfirm}
          >
            Delete my account
          </button>
        </div>
      </div>
    </div>
  );
};
