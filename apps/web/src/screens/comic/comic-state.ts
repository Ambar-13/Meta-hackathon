import { useState } from "react";
import type { Avatar, ComicView } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, routes, usePolledView, type PolledView } from "../../app-shell/index.js";

// How often the page reads the comic while it is drawing, in milliseconds: the card screen's interval.
export const COMIC_POLL_MS = 3_000;
// The reasons a comic was not drawn that the copy names. A failed comic is always render_failed; a skipped one has no reason on its view.
export type ComicSkipReason = "deadline" | "prompt_blocked" | "render_failed" | "no_supported_lines";
// The sentence each skip reason shows, from the copy table of the comic spec.
export const SKIP_COPY: Readonly<Record<ComicSkipReason, string>> = {
  deadline: "The drawing took too long this time. The brief stays.",
  prompt_blocked: "We did not draw this one: a line in the brief carried something we never send to an image model.",
  render_failed: "The image model did not return six usable panels.",
  no_supported_lines: "No brief line passed the support check, so there was nothing to draw.",
};
// The sentence for a skipped comic whose reason the view does not carry.
export const SKIP_COPY_OTHER = "No comic this time.";
// The copy shown while a comic is drawing.
export const RENDERING_COPY = "Drawing your comic. Up to a minute.";
// The copy shown when the brief is not written yet.
export const BRIEF_NOT_READY_COPY = "The brief comes first. The comic unlocks when it lands.";

// What the comic page shows right now.
export type ComicScreenState =
  | { kind: "loading" }
  | { kind: "pick"; avatar: Avatar | null }
  | { kind: "rendering" }
  | { kind: "ready"; panels: ComicView["panels"] }
  | { kind: "skipped"; reason: ComicSkipReason | null }
  | { kind: "brief_not_ready" }
  | { kind: "error"; error: ApiError };
// The page's state plus the two actions: pick an avatar, and ask for the comic.
export type ComicHook = ComicScreenState & { isSending: boolean; requestError: ApiError | null; pick: (avatar: Avatar) => void; request: () => Promise<void> };

// Reads the comic view, polls while it draws, and posts the request for the chosen avatar.
export function useComicState(meetingId: string): ComicHook {
  const polled: PolledView<ComicView> = usePolledView(() => apiFetch(routes.briefs.readComic, { params: { id: meetingId } }), {
    key: meetingId,
    intervalMs: COMIC_POLL_MS,
    keepPolling: (view) => view.state === "rendering",
  });
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [isSending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<ApiError | null>(null);
  const [isBriefMissing, setBriefMissing] = useState(false);

  const request = async (): Promise<void> => {
    if (avatar === null) return;
    setSending(true);
    setRequestError(null);
    try {
      await apiFetch(routes.briefs.requestComic, { params: { id: meetingId }, body: { avatar } });
      setBriefMissing(false);
      polled.reload();
    } catch (thrown: unknown) {
      const error = asApiError(thrown);
      if (error.code === "brief_not_ready") setBriefMissing(true);
      else setRequestError(error);
    } finally {
      setSending(false);
    }
  };

  const base = stateOf(polled, isBriefMissing, avatar);
  return { ...base, isSending, requestError, pick: setAvatar, request };
}

// Maps the polled view and the brief check to the one state the page shows.
function stateOf(polled: PolledView<ComicView>, isBriefMissing: boolean, avatar: Avatar | null): ComicScreenState {
  if (isBriefMissing) return { kind: "brief_not_ready" };
  if (polled.error !== null) {
    if (polled.error.status === 404) return { kind: "pick", avatar };
    return { kind: "error", error: polled.error };
  }
  const view = polled.value;
  if (view === null) return { kind: "loading" };
  if (view.state === "rendering") return { kind: "rendering" };
  if (view.state === "ready") return { kind: "ready", panels: view.panels };
  if (view.state === "failed") return { kind: "skipped", reason: "render_failed" };
  return { kind: "skipped", reason: null };
}
