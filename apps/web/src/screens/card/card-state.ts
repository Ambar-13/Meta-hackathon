import { useEffect, useState } from "react";
import { CARD_POLL_MS, type CardItem, type CardView } from "@meet-first/contracts";
import {
  apiFetch,
  asApiError,
  ApiError,
  APP_PATHS,
  rememberApprovedCard,
  routes,
  usePolledView,
  type PolledView,
} from "../../app-shell/index.js";

// The label of each item kind (drafted copy).
export const KIND_LABELS: Record<CardItem["kind"], string> = {
  value: "Value",
  preference: "Preference",
  habit: "Habit",
  boundary: "Boundary",
  goal: "Goal",
};
// Where the approve, quiz and rebuild calls stand.
export type CardActionState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "approved" }
  | { kind: "failed"; error: ApiError };

// The approve, quiz and rebuild actions of the card page; go navigates after a quiz or a rebuild.
function useCardActions(options: {
  cardId: string;
  sourceId: string;
  reload: () => void;
  go: (path: string) => void;
}): {
  action: CardActionState;
  approve: (itemIds: string[], isRecallAllowed: boolean) => Promise<void>;
  startQuiz: () => Promise<void>;
  rebuild: () => Promise<void>;
} {
  const { cardId, sourceId, reload, go } = options;
  const [action, setAction] = useState<CardActionState>({ kind: "idle" });

  const approve = async (itemIds: string[], isRecallAllowed: boolean): Promise<void> => {
    setAction({ kind: "sending" });
    try {
      await apiFetch(routes.cards.approveCard, {
        params: { id: cardId },
        body: { itemIds, recallAllowed: isRecallAllowed },
      });
      rememberApprovedCard(cardId);
      setAction({ kind: "approved" });
      reload();
    } catch (thrown: unknown) {
      setAction({ kind: "failed", error: asApiError(thrown) });
    }
  };

  const startQuiz = async (): Promise<void> => {
    setAction({ kind: "sending" });
    try {
      const reply = await apiFetch(routes.cards.requestQuiz, { params: { id: cardId } });
      go(APP_PATHS.quiz(reply.quizId));
    } catch (thrown: unknown) {
      setAction({ kind: "failed", error: asApiError(thrown) });
    }
  };

  const rebuild = async (): Promise<void> => {
    setAction({ kind: "sending" });
    try {
      const reply = await apiFetch(routes.sources.requestCard, { params: { id: sourceId } });
      go(APP_PATHS.card(reply.cardId));
    } catch (thrown: unknown) {
      setAction({ kind: "failed", error: asApiError(thrown) });
    }
  };

  return { action, approve, startQuiz, rebuild };
}

// The card screen's state and actions; go navigates.
export function useCardScreen(
  cardId: string,
  go: (path: string) => void,
): {
  polled: PolledView<CardView>;
  firstServerNow: string | null;
  ticked: ReadonlySet<string>;
  isRecallAllowed: boolean;
  action: CardActionState;
  toggleItem: (itemId: string) => void;
  setRecallAllowed: (isAllowed: boolean) => void;
  approveCard: () => Promise<void>;
  startQuiz: () => Promise<void>;
  rebuild: () => Promise<void>;
} {
  const polled = usePolledView(() => apiFetch(routes.cards.readCard, { params: { id: cardId } }), {
    key: cardId,
    intervalMs: CARD_POLL_MS,
    keepPolling: (card) => card.state === "building",
  });
  const [firstServerNow, setFirstServerNow] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [isRecallAllowed, setRecallAllowedState] = useState(false);
  const actions = useCardActions({
    cardId,
    sourceId: polled.value?.sourceId ?? "",
    reload: polled.reload,
    go,
  });

  useEffect(() => {
    if (firstServerNow === null && polled.value !== null) setFirstServerNow(polled.value.serverNow);
  }, [firstServerNow, polled.value]);

  const toggleItem = (itemId: string): void => {
    const item = polled.value?.items.find((candidate) => candidate.id === itemId);
    if (item === undefined || !item.verified) return;
    setTicked((previous) => {
      const next = new Set(previous);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const approveCard = async (): Promise<void> => {
    if (ticked.size === 0) return;
    const itemIds = (polled.value?.items ?? [])
      .filter((item) => ticked.has(item.id))
      .map((item) => item.id);
    await actions.approve(itemIds, isRecallAllowed);
  };

  return {
    polled,
    firstServerNow,
    ticked,
    isRecallAllowed,
    action: actions.action,
    toggleItem,
    setRecallAllowed: setRecallAllowedState,
    approveCard,
    startQuiz: actions.startQuiz,
    rebuild: actions.rebuild,
  };
}
