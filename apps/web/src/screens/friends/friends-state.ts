// What exists: GET /api/friends lists the caller's friends with their friend-ask switch (directory-api), and GET /api/asks lists the
// answers the caller's persona gave (this builder). The problem: both lists load once, and a friend ask must reach the API only when
// its text has 5 to 300 characters. The step: two loads through the shared polling hook, which tries a failed load again every
// ASK_POLL_MS, and one send action. What it does not do: read the lists again after they loaded; the page shows them as they were.
import { useState } from "react";
import { ASK_POLL_MS, type AsksView, type FriendsView } from "@meet-first/contracts";
import { apiFetch, APP_PATHS, asApiError, routes, usePolledView, type ApiError, type PolledView } from "../../app-shell/index.js";

// The fewest and the most characters of a friend ask, the bounds of AskCreate in contracts.
const ASK_MIN_CHARACTERS = 5;
const ASK_MAX_CHARACTERS = 300;
// The line shown when the ask is shorter or longer than that: the lobby's words for a free-text question.
const ASK_LENGTH_LINE = "Write a question of 5 to 300 characters.";

// The friends page's model: both lists, the chosen friend, and the friend ask action with its busy flag, its length line and its error.
export type FriendsScreenModel = {
  friends: PolledView<FriendsView>;
  asks: PolledView<AsksView>;
  chosenPairId: string | null;
  isSending: boolean;
  formLine: string | null;
  sendError: ApiError | null;
  choose: (pairId: string) => void;
  sendReactAsk: (pairId: string, text: string) => Promise<void>;
};

// Loads the friends and the caller's asks once each, and sends a friend ask, then opens its answers page; go navigates (design section 7).
export function useFriendsScreen(go: (path: string) => void): FriendsScreenModel {
  const friends = usePolledView(() => apiFetch(routes.directory.friends), { key: "friends", intervalMs: ASK_POLL_MS, keepPolling: () => false });
  const asks = usePolledView(() => apiFetch(routes.asks.listAsks), { key: "asks", intervalMs: ASK_POLL_MS, keepPolling: () => false });
  const [chosenPairId, setChosenPairId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [formLine, setFormLine] = useState<string | null>(null);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const choose = (pairId: string): void => {
    setChosenPairId(pairId);
    setFormLine(null);
    setSendError(null);
  };
  const sendReactAsk = async (pairId: string, text: string): Promise<void> => {
    const trimmed = text.trim();
    setSendError(null);
    if (trimmed.length < ASK_MIN_CHARACTERS || trimmed.length > ASK_MAX_CHARACTERS) {
      setFormLine(ASK_LENGTH_LINE);
      return;
    }
    setFormLine(null);
    setIsSending(true);
    try {
      const reply = await apiFetch(routes.asks.createAsk, { body: { mode: "react", pairId, text: trimmed } });
      go(APP_PATHS.ask(reply.askId));
    } catch (thrown: unknown) {
      setSendError(asApiError(thrown));
      setIsSending(false);
    }
  };
  return { friends, asks, chosenPairId, isSending, formLine, sendError, choose, sendReactAsk };
}
