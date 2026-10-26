import { useEffect, useState } from "react";
import { LOBBY_POLL_MS, MeetingCreate, type MeetingState, type MeetingView, type PairMeetingRow, type PairView } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, meetingPathWithSide, readViewerSide, rememberViewerSide, routes, usePolledView, type PolledView } from "../../app-shell/index.js";

// The lobby's label for each meeting state [confirm] (drafted copy, no input gives it).
export const MEETING_STATE_LABELS: Record<MeetingState, string> = { ready: "Not started", queued: "In the queue", running: "Running", ended: "Ended", deleted: "Gone" };

// A picked question: one of the 12 curated ids, or free text (R10.5).
export type QuestionPick = { kind: "curated"; questionId: number } | { kind: "free"; text: string };

// The meeting the lobby works on: the newest row of PairView.meetings that is ready, queued or running, or null (the list is newest first).
export function currentMeetingRow(pair: PairView): PairMeetingRow | null {
  return pair.meetings.find((row) => row.state === "ready" || row.state === "queued" || row.state === "running") ?? null;
}

// The MeetingCreate body for a pick and a card, or null when free text is not 5 to 300 characters after trimming (R10.5).
export function meetingCreateBody(pick: QuestionPick, cardId: string): MeetingCreate | null {
  if (pick.kind === "curated") return MeetingCreate.parse({ questionId: pick.questionId, cardId });
  const text = pick.text.trim();
  if (text.length < 5 || text.length > 300) return null;
  return MeetingCreate.parse({ freeText: text, cardId });
}

// The create-meeting and ready actions of the lobby, with their busy state and the last error.
function useLobbyActions(options: { pairId: string; cardId: string | null; current: PairMeetingRow | null; reloads: { pair: () => void; meeting: () => void } }): {
  actionError: ApiError | null;
  createError: string | null;
  isBusy: boolean;
  create: (pick: QuestionPick) => Promise<void>;
  markReady: () => Promise<void>;
} {
  const { pairId, cardId, current, reloads } = options;
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isMarking, setIsMarking] = useState(false);

  const create = async (pick: QuestionPick): Promise<void> => {
    if (cardId === null) return;
    const body = meetingCreateBody(pick, cardId);
    if (body === null) {
      setCreateError("Write a question of 5 to 300 characters.");
      return;
    }
    setCreateError(null);
    setIsCreating(true);
    try {
      const reply = await apiFetch(routes.meetings.createMeeting, { params: { id: pairId }, body });
      rememberViewerSide(reply.meetingId, "a");
      reloads.pair();
    } catch (thrown: unknown) {
      setActionError(asApiError(thrown));
    } finally {
      setIsCreating(false);
    }
  };

  const markReady = async (): Promise<void> => {
    if (current === null) return;
    setIsMarking(true);
    try {
      await apiFetch(routes.meetings.ready, { params: { id: current.id } });
      reloads.meeting();
    } catch (thrown: unknown) {
      setActionError(asApiError(thrown));
    } finally {
      setIsMarking(false);
    }
  };

  return { actionError, createError, isBusy: isCreating || isMarking, create, markReady };
}

// The lobby's state and actions; go navigates (D54, R10.5).
export function useLobby(
  pairId: string,
  cardId: string | null,
  go: (path: string) => void,
): {
  pair: PolledView<PairView>;
  meeting: PolledView<MeetingView | null>;
  current: PairMeetingRow | null;
  actionError: ApiError | null;
  createError: string | null;
  isBusy: boolean;
  create: (pick: QuestionPick) => Promise<void>;
  markReady: () => Promise<void>;
} {
  const pair = usePolledView(() => apiFetch(routes.meetings.readPair, { params: { id: pairId } }), {
    key: pairId,
    intervalMs: LOBBY_POLL_MS,
    keepPolling: () => true,
  });
  const current = pair.value === null ? null : currentMeetingRow(pair.value);
  const meeting = usePolledView<MeetingView | null>(
    () => (current === null ? Promise.resolve(null) : apiFetch(routes.meetings.readMeeting, { params: { id: current.id } })),
    {
      key: current?.id ?? "none",
      intervalMs: LOBBY_POLL_MS,
      keepPolling: (value) => value !== null && (value.state === "ready" || value.state === "queued"),
    },
  );
  const actions = useLobbyActions({ pairId, cardId, current, reloads: { pair: pair.reload, meeting: meeting.reload } });

  const runningId = meeting.value?.state === "running" ? meeting.value.id : null;
  useEffect(() => {
    if (runningId !== null) go(meetingPathWithSide(runningId, readViewerSide(runningId)));
    // Only a change of the running meeting moves the person, so the effect depends on its id.
  }, [runningId]);

  return { pair, meeting, current, ...actions };
}
