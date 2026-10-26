import { useEffect, useState } from "react";
import type { Brief, BriefPoint, Quote } from "@meet-first/contracts";
import { apiFetch, asApiError, routes } from "../../app-shell/index.js";

// How long the screen waits before it asks again while the brief is being written, in milliseconds (R3.4, the card screen's interval) [confirm].
export const BRIEF_POLL_MS = 3_000;

// The quote the sheet shows: the line it was tapped from and the quote itself.
export type OpenQuote = { lineText: string; quote: Quote };
// Where the brief screen stands: loading, waiting for the server, showing a brief, gone, or failed with a code.
export type BriefScreenState =
  | { kind: "loading" }
  | { kind: "waiting"; startedAt: number }
  | { kind: "ready"; brief: Brief; openQuote: OpenQuote | null }
  | { kind: "gone" }
  | { kind: "error"; code: string };

// What the fetch loop has loaded so far, before the quote sheet is added.
type LoadState = { kind: "loading" } | { kind: "waiting"; startedAt: number } | { kind: "ready"; brief: Brief } | { kind: "gone" } | { kind: "error"; code: string };

// The brief screen's state, with the two actions that show and hide the quote sheet.
export type BriefScreenHook = BriefScreenState & { showQuote: (lineText: string, quote: Quote) => void; hideQuote: () => void };

// Loads the caller's brief and asks again every BRIEF_POLL_MS while the server says it is not written yet (R3.4).
export function useBriefState(meetingId: string): BriefScreenHook {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [sheet, setSheet] = useState<OpenQuote | null>(null);

  useEffect(() => {
    let isActive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const run = async (): Promise<void> => {
      try {
        const brief = await apiFetch(routes.briefs.readBrief, { params: { id: meetingId } });
        if (isActive) setLoad({ kind: "ready", brief });
      } catch (thrown: unknown) {
        if (!isActive) return;
        const error = asApiError(thrown);
        if (error.code === "brief_not_ready") {
          setLoad({ kind: "waiting", startedAt });
          timer = setTimeout(() => void run(), BRIEF_POLL_MS);
          return;
        }
        if (error.code === "brief_not_found" || error.status === 403) setLoad({ kind: "gone" });
        else setLoad({ kind: "error", code: error.code });
      }
    };
    void run();
    return () => {
      isActive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [meetingId]);

  const showQuote = (lineText: string, quote: Quote): void => {
    setSheet({ lineText, quote });
  };
  const hideQuote = (): void => {
    setSheet(null);
  };
  const base: BriefScreenState = load.kind === "ready" ? { kind: "ready", brief: load.brief, openQuote: sheet } : load;
  return { ...base, showQuote, hideQuote };
}

// Whether a line passes into Decide this first: supported is true and every quote is verified (invariant 19).
function isPassing(point: BriefPoint): boolean {
  return point.supported === true && point.quotes.every((quote) => quote.verified);
}

// Splits a brief into what each section shows. Decide-first lines that do not pass move to Set aside.
export function splitBriefForDisplay(brief: Brief): { agree: BriefPoint[]; clash: BriefPoint[]; decideFirst: BriefPoint[]; setAside: BriefPoint[] } {
  return {
    agree: brief.agree,
    clash: brief.clash,
    decideFirst: brief.decideFirst.filter(isPassing),
    setAside: brief.decideFirst.filter((point) => !isPassing(point)),
  };
}

// True when a line carries the weak receipt mark: the support check did not support it, or did not run (A1).
export function isWeakReceipt(point: BriefPoint): boolean {
  return point.supported !== true;
}
