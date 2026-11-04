import { useRef, useState } from "react";
import { apiFetch, asApiError, clearClientState, routes } from "../../app-shell/index.js";

// The delete flow: idle, the dialog open, the request sent, the account deleted with its id, or a
// failure with its code.
export type DeleteFlowState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "deleting" }
  | { kind: "deleted"; deletionId: string }
  | { kind: "error"; code: string };

// The code the flow stores when the server says the session is gone (401 or 403), so the dialog
// shows the session sentence.
export const SESSION_ENDED_CODE = "session_ended";

// Drives the delete dialog: open, confirm, call DELETE /api/people/me once, then clear client state
// and show the deleted notice.
export function useDeleteAccount(): DeleteFlowState & {
  open: () => void;
  cancel: () => void;
  confirm: () => Promise<void>;
} {
  const [flow, setFlow] = useState<DeleteFlowState>({ kind: "idle" });
  const isRequestSent = useRef(false);
  // Sends the delete request; a second call while one is in flight does nothing, so a double click
  // sends one request.
  const confirm = async (): Promise<void> => {
    if (isRequestSent.current) return;
    isRequestSent.current = true;
    setFlow({ kind: "deleting" });
    try {
      const reply = await apiFetch(routes.people.deleteMe);
      clearClientState();
      setFlow({ kind: "deleted", deletionId: reply.deletionId });
    } catch (thrown: unknown) {
      isRequestSent.current = false;
      const error = asApiError(thrown);
      const isSessionGone = error.status === 401 || error.status === 403;
      setFlow({ kind: "error", code: isSessionGone ? SESSION_ENDED_CODE : error.code });
    }
  };
  return {
    ...flow,
    open: () => {
      setFlow({ kind: "confirming" });
    },
    cancel: () => {
      setFlow({ kind: "idle" });
    },
    confirm,
  };
}
