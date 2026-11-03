import { useState } from "react";
import { SUMMARY_MAX_CHARS, type SummaryPoint, type SummaryView } from "@meet-first/contracts";
import { formatSummary, parseSummary, summaryPriority, type SummaryPriority } from "@meet-first/parsers";
import promptMarkdown from "../../../../../packages/prompts/summary-request/v1/prompt.md?raw";
import { apiFetch, ApiError, asApiError, routes, usePolledView, type PolledView } from "../../app-shell/index.js";

// The copy prompt as a person pastes it into their own AI: prompt.md without its version block.
export const SUMMARY_PROMPT = promptMarkdown.replace(/^<version>[\s\S]*?<\/version>\s*/u, "");
// How often the page reads the summary again while it is being checked.
const CHECKING_POLL_MS = 3_000;

// Where the copy button stands: not pressed, copied, or refused by the browser, which then shows the prompt to copy by hand.
export type CopyState = "idle" | "copied" | "refused";
// Where a save or a delete stands.
export type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; error: ApiError };
// Everything the summary section shows and does. The page that holds it passes priority to the file check.
export type SummaryHook = {
  view: PolledView<SummaryView | null>;
  draft: string;
  points: SummaryPoint[];
  isTooLong: boolean;
  isFriendsOn: boolean;
  isReplacing: boolean;
  copy: CopyState;
  send: SendState;
  priority: SummaryPriority | undefined;
  setDraft: (text: string) => void;
  removePoint: (index: number) => void;
  setFriendsOn: (isOn: boolean) => void;
  startReplacing: () => void;
  copyPrompt: () => Promise<void>;
  save: () => Promise<void>;
  remove: () => Promise<void>;
};

// The saved summary from GET /api/people/me/summary, or null when there is none.
async function readSavedSummary(): Promise<SummaryView | null> {
  try {
    return await apiFetch(routes.people.readSummary);
  } catch (thrown: unknown) {
    if (thrown instanceof ApiError && thrown.status === 404) return null;
    throw thrown;
  }
}

// The paste box and the points read from it, less the ones the person removed; a new paste brings every point back.
function useDraft(): Pick<SummaryHook, "draft" | "points" | "setDraft" | "removePoint"> {
  const [draft, setDraftText] = useState("");
  const [points, setPoints] = useState<SummaryPoint[]>([]);
  const setDraft = (text: string): void => {
    setDraftText(text);
    setPoints(parseSummary(text));
  };
  const removePoint = (index: number): void => {
    setPoints((current) => current.filter((point, at) => at !== index));
  };
  return { draft, points, setDraft, removePoint };
}

// Puts the prompt on the clipboard; a browser that refuses, or has no clipboard, shows the prompt to copy by hand.
function useCopyPrompt(): Pick<SummaryHook, "copy" | "copyPrompt"> {
  const [copy, setCopy] = useState<CopyState>("idle");
  const copyPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(SUMMARY_PROMPT);
      setCopy("copied");
    } catch {
      setCopy("refused");
    }
  };
  return { copy, copyPrompt };
}

// The section's state: the saved summary, read again every 3 seconds while it is checked; the paste box, the switch, and save and
// delete, each of which reads the summary again. Until the check stores points, the priority comes from the points saved last.
export function useSummary(): SummaryHook {
  const view = usePolledView(readSavedSummary, { key: "summary", intervalMs: CHECKING_POLL_MS, keepPolling: (value) => value?.state === "checking" });
  const draft = useDraft();
  const copy = useCopyPrompt();
  const [isFriendsOn, setFriendsOn] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [lastSaved, setLastSaved] = useState<SummaryPoint[]>([]);
  const text = formatSummary(draft.points);
  const run = async (request: () => Promise<unknown>, after: () => void): Promise<void> => {
    setSend({ kind: "sending" });
    try {
      await request();
      setSend({ kind: "idle" });
      after();
      view.reload();
    } catch (thrown: unknown) {
      setSend({ kind: "failed", error: asApiError(thrown) });
    }
  };
  const save = (): Promise<void> => run(() => apiFetch(routes.people.saveSummary, { body: { text, friendsCanAsk: isFriendsOn } }), () => {
    setLastSaved(draft.points);
    draft.setDraft("");
    setIsReplacing(false);
  });
  const remove = (): Promise<void> => run(() => apiFetch(routes.people.deleteSummary), () => {
    setLastSaved([]);
    setFriendsOn(false);
  });
  const startReplacing = (): void => {
    setFriendsOn(view.value?.friendsCanAsk ?? false);
    setIsReplacing(true);
  };
  const saved = view.value !== null && view.value.points.length > 0 ? view.value.points : lastSaved;
  const priority = saved.length > 0 ? summaryPriority(saved) : undefined;
  return { view, ...draft, ...copy, isTooLong: text.length > SUMMARY_MAX_CHARS, isFriendsOn, isReplacing, send, priority, setFriendsOn, startReplacing, save, remove };
}
