import { useEffect, useRef, useState } from "react";
import { LOBBY_POLL_MS, type MeetingView } from "@meet-first/contracts";
import { apiFetch, ApiError, routes, usePolledView, type PolledView } from "../../app-shell/index.js";
import { emptyMeetingState, type MeetingFoldState } from "../../transcript/index.js";
import type { FeedStatus, MeetingFeed, MeetingFeedOptions } from "../../streaming/index.js";

// The status line while the feed polls (D49, R8.2) [confirm] (drafted copy, no input gives it).
export const POLLING_COPY = "Live updates are slow on this network, so this screen checks for new turns every 2 seconds.";
// The status line while the feed waits to reconnect (D51, R8.4) [confirm] (drafted copy, no input gives it).
export const RECONNECTING_COPY = "Connection lost. Reconnecting.";

// The meeting screen's model: the meeting view, the folded events, the feed status, when something last arrived, and a stop error.
export type MeetingScreenModel = { view: PolledView<MeetingView>; fold: MeetingFoldState; status: FeedStatus; lastActivityMs: number; stopped: ApiError | null };

// True when the state moved on: a new seq or a longer partial text (R10.3).
function hasChanged(previous: MeetingFoldState, next: MeetingFoldState): boolean {
  return previous.lastSeq !== next.lastSeq || (previous.partial?.text.length ?? -1) !== (next.partial?.text.length ?? -1);
}

// Loads the meeting, polls it while it waits to start, then opens the feed and folds it (D49, D51).
export function useMeetingScreen(meetingId: string, openFeed: (options: MeetingFeedOptions) => MeetingFeed): MeetingScreenModel {
  const view = usePolledView(() => apiFetch(routes.meetings.readMeeting, { params: { id: meetingId } }), {
    key: meetingId,
    intervalMs: LOBBY_POLL_MS,
    keepPolling: (meeting) => meeting.state === "ready" || meeting.state === "queued",
  });
  const [fold, setFold] = useState<MeetingFoldState>(() => emptyMeetingState(meetingId));
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [lastActivityMs, setLastActivityMs] = useState(0);
  const [stopped, setStopped] = useState<ApiError | null>(null);
  const previous = useRef<MeetingFoldState>(emptyMeetingState(meetingId));
  const hasRun = view.value !== null && (view.value.state === "running" || view.value.state === "ended");

  useEffect(() => {
    if (!hasRun) return undefined;
    const feed = openFeed({
      meetingId,
      onState: (next, nextStatus) => {
        if (hasChanged(previous.current, next)) setLastActivityMs(Date.now());
        previous.current = next;
        setFold(next);
        setStatus(nextStatus);
      },
      onStopped: (error) => {
        setStopped(error);
      },
    });
    return () => {
      feed.close();
    };
  }, [hasRun, meetingId, openFeed]);

  return { view, fold, status, lastActivityMs, stopped };
}

// The phone's time, updated every second while the screen is open, for the thinking line.
export function useSecondTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
