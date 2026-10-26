import { useEffect, useState } from "react";
import { type ConsentResponse, type MeetingView, type ShareSnapshot } from "@meet-first/contracts";
import { apiFetch, asApiError, routes, type ApiError } from "../../app-shell/index.js";

// Where the consent screen stands: loading, closed until both briefs exist, open with both flags, or failed with a code and a sentence.
export type ConsentState =
  | { kind: "loading" }
  | { kind: "closed"; reason: "brief_not_ready" }
  | { kind: "open"; consentA: boolean; consentB: boolean; mySide: "a" | "b"; published: boolean; slug?: string }
  | { kind: "error"; code: string; message: string };

// Where the public page stands: loading, the snapshot, no page (404), or a failure the page shows as a sentence.
export type PublicSnapshotState = { kind: "loading" } | { kind: "ready"; snapshot: ShareSnapshot } | { kind: "not_found" } | { kind: "error"; code: string; message: string };

// The error state for one failed call.
function errorOf(error: ApiError): ConsentState {
  return { kind: "error", code: error.code, message: error.message };
}

// The state after a successful read of the meeting: open once the meeting has ended, closed until then.
// The consent flags are not in the meeting view, so they start false and the first consent reply sets them.
function stateFromMeeting(view: MeetingView): ConsentState {
  if (view.state !== "ended") return { kind: "closed", reason: "brief_not_ready" };
  return { kind: "open", consentA: false, consentB: false, mySide: view.viewerSide, published: false };
}

// The open state after a consent reply; the side stays the one the screen already knows.
function openFrom(current: ConsentState, reply: ConsentResponse): ConsentState {
  if (current.kind !== "open") return current;
  return {
    kind: "open",
    consentA: reply.consentA,
    consentB: reply.consentB,
    mySide: current.mySide,
    published: reply.published,
    ...(reply.slug === undefined ? {} : { slug: reply.slug }),
  };
}

// The open state after this person withdrew: their flag is false, the page is down, and the other flag is kept.
function withdrawnFrom(current: ConsentState): ConsentState {
  if (current.kind !== "open") return current;
  return {
    kind: "open",
    consentA: current.mySide === "a" ? false : current.consentA,
    consentB: current.mySide === "b" ? false : current.consentB,
    mySide: current.mySide,
    published: false,
  };
}

// The consent screen's state and its two actions: consent (POST) and withdraw (DELETE), for one meeting.
export function useConsentState(meetingId: string): ConsentState & { consent: () => Promise<void>; withdraw: () => Promise<void> } {
  const [state, setState] = useState<ConsentState>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    const load = async (): Promise<void> => {
      try {
        const view = await apiFetch(routes.meetings.readMeeting, { params: { id: meetingId } });
        if (isCurrent) setState(stateFromMeeting(view));
      } catch (thrown: unknown) {
        if (isCurrent) setState(errorOf(asApiError(thrown)));
      }
    };
    void load();
    return () => {
      isCurrent = false;
    };
  }, [meetingId]);

  const consent = async (): Promise<void> => {
    try {
      const reply = await apiFetch(routes.briefs.consent, { params: { id: meetingId } });
      setState((current) => openFrom(current, reply));
    } catch (thrown: unknown) {
      const error = asApiError(thrown);
      setState(error.code === "brief_not_ready" ? { kind: "closed", reason: "brief_not_ready" } : errorOf(error));
    }
  };

  const withdraw = async (): Promise<void> => {
    try {
      await apiFetch(routes.briefs.withdrawConsent, { params: { id: meetingId } });
      setState((current) => withdrawnFrom(current));
    } catch (thrown: unknown) {
      setState(errorOf(asApiError(thrown)));
    }
  };

  return { ...state, consent, withdraw };
}

// Loads the public snapshot of one slug; a 404 is the not-found face, never an error.
export function usePublicSnapshot(slug: string): PublicSnapshotState {
  const [state, setState] = useState<PublicSnapshotState>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    const load = async (): Promise<void> => {
      try {
        const snapshot = await apiFetch(routes.briefs.readShare, { params: { slug } });
        if (isCurrent) setState({ kind: "ready", snapshot });
      } catch (thrown: unknown) {
        const error = asApiError(thrown);
        if (!isCurrent) return;
        setState(error.status === 404 ? { kind: "not_found" } : { kind: "error", code: error.code, message: error.message });
      }
    };
    void load();
    return () => {
      isCurrent = false;
    };
  }, [slug]);

  return state;
}
