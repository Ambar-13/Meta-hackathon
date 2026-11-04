import { useEffect, useState } from "react";
import {
  apiFetch,
  asApiError,
  ApiError,
  routes,
  usePolledView,
  type PolledView,
} from "../../app-shell/index.js";
import { NamesReview, SourceView } from "@meet-first/contracts";

// How often the names screen polls while the source is not frozen (the 3 s card interval).
export const NAMES_POLL_MS = 3_000;
// The sensitive categories offered as opt-ins; minor is never offered, because a named minor has no toggle (the stricter reading: fewer ways to expose a minor).
export const OFFERED_OPT_INS = ["health", "address", "identifier"] as const;
// One offered opt-in.
export type SensitiveOptIn = (typeof OFFERED_OPT_INS)[number];
// The label of each offered opt-in (drafted copy).
export const OPT_IN_LABELS: Record<SensitiveOptIn, string> = {
  health: "Health",
  address: "Home and street addresses",
  identifier: "ID and account numbers",
};
// Where saving stands.
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "review_failed"; error: ApiError }
  | { kind: "card_failed"; error: ApiError };
// The mode of the review and the names the person keeps, with the opt-ins they ticked.
export type ReviewChoice = {
  mode: "replace_all" | "choose";
  kept: ReadonlySet<string>;
  optIns: ReadonlySet<SensitiveOptIn>;
};

// Builds the review body: every name seen so far, keep true only for kept names in choose mode, and the ticked opt-ins.
export function buildNamesReview(seenNames: readonly string[], choice: ReviewChoice): NamesReview {
  const decisions = seenNames.map((text) => ({
    text,
    keep: choice.mode === "choose" && choice.kept.has(text),
  }));
  const sensitiveOptIn: NamesReview["sensitiveOptIn"] = OFFERED_OPT_INS.filter((optIn) =>
    choice.optIns.has(optIn),
  );
  return NamesReview.parse({ decisions, sensitiveOptIn });
}

// Adds the names of one poll to the names seen so far, keeping the first-seen order.
function addSeen(seen: readonly string[], view: SourceView | null): string[] {
  if (view === null) return [...seen];
  const next = [...seen];
  for (const row of view.names.rows) {
    if (!next.includes(row.text)) next.push(row.text);
  }
  return next;
}

// Returns a copy of a set with one value added when it is missing, or removed when it is there.
function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// The review choices: the mode, the names kept, and the opt-ins ticked.
function useReviewChoices(): {
  mode: "replace_all" | "choose";
  kept: ReadonlySet<string>;
  optIns: ReadonlySet<SensitiveOptIn>;
  setMode: (mode: "replace_all" | "choose") => void;
  toggleKeep: (text: string) => void;
  toggleOptIn: (optIn: SensitiveOptIn) => void;
} {
  const [mode, setMode] = useState<"replace_all" | "choose">("replace_all");
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [optIns, setOptIns] = useState<ReadonlySet<SensitiveOptIn>>(new Set());
  const toggleKeep = (text: string): void => {
    if (mode === "choose") setKept((previous) => toggled(previous, text));
  };
  const toggleOptIn = (optIn: SensitiveOptIn): void => {
    setOptIns((previous) => toggled(previous, optIn));
  };
  return { mode, kept, optIns, setMode, toggleKeep, toggleOptIn };
}

// The save of the review and the card request after it.
function useReviewSave(
  sourceId: string,
  onCardRequested: (cardId: string) => void,
): {
  save: SaveState;
  requestCard: () => Promise<void>;
  saveReview: (body: NamesReview) => Promise<void>;
} {
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const requestCard = async (): Promise<void> => {
    try {
      const reply = await apiFetch(routes.sources.requestCard, { params: { id: sourceId } });
      onCardRequested(reply.cardId);
    } catch (thrown: unknown) {
      setSave({ kind: "card_failed", error: asApiError(thrown) });
    }
  };

  const saveReview = async (body: NamesReview): Promise<void> => {
    setSave({ kind: "saving" });
    try {
      await apiFetch(routes.sources.namesReview, { params: { id: sourceId }, body });
    } catch (thrown: unknown) {
      setSave({ kind: "review_failed", error: asApiError(thrown) });
      return;
    }
    await requestCard();
  };

  return { save, requestCard, saveReview };
}

// The names review screen's state and actions.
export function useNamesReview(
  sourceId: string,
  onCardRequested: (cardId: string) => void,
): {
  polled: PolledView<SourceView>;
  page: number;
  mode: "replace_all" | "choose";
  kept: ReadonlySet<string>;
  optIns: ReadonlySet<SensitiveOptIn>;
  isStable: boolean;
  save: SaveState;
  setPage: (page: number) => void;
  setMode: (mode: "replace_all" | "choose") => void;
  toggleKeep: (text: string) => void;
  toggleOptIn: (optIn: SensitiveOptIn) => void;
  saveReview: () => Promise<void>;
  requestCard: () => Promise<void>;
} {
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState<string[]>([]);
  const choices = useReviewChoices();
  const reviewSave = useReviewSave(sourceId, onCardRequested);
  const polled = usePolledView(
    () => apiFetch(routes.sources.readSource, { params: { id: sourceId }, query: { page } }),
    {
      key: `${sourceId}:${String(page)}`,
      intervalMs: NAMES_POLL_MS,
      keepPolling: (view) => view.frozenAt === null,
    },
  );

  useEffect(() => {
    setSeen((previous) => addSeen(previous, polled.value));
  }, [polled.value]);

  const saveReview = async (): Promise<void> => {
    await reviewSave.saveReview(buildNamesReview(seen, choices));
  };

  return {
    polled,
    page,
    mode: choices.mode,
    kept: choices.kept,
    optIns: choices.optIns,
    isStable: polled.value?.namesPassDone === true,
    save: reviewSave.save,
    setPage,
    setMode: choices.setMode,
    toggleKeep: choices.toggleKeep,
    toggleOptIn: choices.toggleOptIn,
    saveReview,
    requestCard: reviewSave.requestCard,
  };
}
