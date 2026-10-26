// What exists: run_ask moves an ask from checking to asking to ranking, then to done, refused or failed (design section 4).
// The problem: the page must follow those steps without a stream, stop when the ask ends, and start a meeting with a helper.
// The step: the shared polling hook reads the ask every ASK_POLL_MS (3 s) while it runs, and one action posts the meeting.
// What it does not do: show anything; screen.tsx and answer-parts.tsx do.
import { useState } from "react";
import { ASK_POLL_MS, type AskView } from "@meet-first/contracts";
import { apiFetch, APP_PATHS, asApiError, routes, usePolledView, type ApiError, type PolledView } from "../../app-shell/index.js";

// The states after which the page stops reading the ask (design section 7).
const FINISHED_STATES: ReadonlySet<AskView["state"]> = new Set(["done", "refused", "failed"]);

// The answers page's model: the polled ask, whether a meeting is being started, the last meeting error, and the action that starts one.
export type AskScreenModel = {
  ask: PolledView<AskView>;
  isMeeting: boolean;
  meetError: ApiError | null;
  startMeeting: (answerId: string, cardId: string) => Promise<void>;
};

// True while the ask still runs (checking, asking or ranking), so the page reads it again ASK_POLL_MS after each reply.
export function isAskRunning(view: AskView): boolean {
  return !FINISHED_STATES.has(view.state);
}

// The answers of a help search as the page shows them: the placed answers, then the answers with no position, each in the server's order.
export function splitHelpAnswers(answers: AskView["answers"]): { placed: AskView["answers"]; unplaced: AskView["answers"] } {
  return { placed: answers.filter((answer) => answer.position !== null), unplaced: answers.filter((answer) => answer.position === null) };
}

// Reads the ask every ASK_POLL_MS until it is done, refused or failed, and starts a meeting with a helper, then opens the meeting; go
// navigates (design section 7).
export function useAskScreen(askId: string, go: (path: string) => void): AskScreenModel {
  const ask = usePolledView(() => apiFetch(routes.asks.readAsk, { params: { id: askId } }), { key: askId, intervalMs: ASK_POLL_MS, keepPolling: isAskRunning });
  const [isMeeting, setIsMeeting] = useState(false);
  const [meetError, setMeetError] = useState<ApiError | null>(null);
  const startMeeting = async (answerId: string, cardId: string): Promise<void> => {
    setMeetError(null);
    setIsMeeting(true);
    try {
      const reply = await apiFetch(routes.asks.meetHelper, { params: { id: askId, answerId }, body: { cardId } });
      go(APP_PATHS.meeting(reply.meetingId));
    } catch (thrown: unknown) {
      setMeetError(asApiError(thrown));
      setIsMeeting(false);
    }
  };
  return { ask, isMeeting, meetError, startMeeting };
}
