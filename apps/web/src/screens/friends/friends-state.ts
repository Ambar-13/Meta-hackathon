// What exists: GET /api/friends lists the caller's friends with their friend-ask switch, GET /api/friend-requests their pending
// requests both ways, and GET /api/asks the answers the caller's persona gave. The problem: the lists load once, a friend ask
// must reach the API only when its text has 5 to 300 characters, and answering a request changes both the requests and the friends.
// The step: three loads through the shared polling hook, which tries a failed load again every ASK_POLL_MS, the send action, and
// Accept and Decline, which read the requests and the friends again. What it does not do: poll the lists after they loaded.
import { useState } from "react";
import { ASK_POLL_MS, type AsksView, type FriendRequestsView, type FriendsView } from "@meet-first/contracts";
import { apiFetch, APP_PATHS, asApiError, routes, usePolledView, type ApiError, type PolledView } from "../../app-shell/index.js";

// The fewest and the most characters of a friend ask, the bounds of AskCreate in contracts.
const ASK_MIN_CHARACTERS = 5;
const ASK_MAX_CHARACTERS = 300;
// The line shown when the ask is shorter or longer than that: the lobby's words for a free-text question.
const ASK_LENGTH_LINE = "Write a question of 5 to 300 characters.";

// Where answering a friend request stands: the request being answered, and the api's sentence when it refused.
export type RequestAnswerState = { busyId: string | null; error: ApiError | null };
// The friends page's model: the three lists, the chosen friend, the friend ask action with its busy flag, its length line and its
// error, and Accept and Decline for incoming requests.
export type FriendsScreenModel = {
  friends: PolledView<FriendsView>;
  requests: PolledView<FriendRequestsView>;
  answer: RequestAnswerState;
  accept: (requestId: string) => Promise<void>;
  decline: (requestId: string) => Promise<void>;
  asks: PolledView<AsksView>;
  chosenPairId: string | null;
  isSending: boolean;
  formLine: string | null;
  sendError: ApiError | null;
  choose: (pairId: string) => void;
  sendReactAsk: (pairId: string, text: string) => Promise<void>;
};

// Loads the friends, the friend requests and the caller's asks once each, sends a friend ask and then opens its answers page (go
// navigates), and answers incoming requests.
export function useFriendsScreen(go: (path: string) => void): FriendsScreenModel {
  const friends = usePolledView(() => apiFetch(routes.directory.friends), { key: "friends", intervalMs: ASK_POLL_MS, keepPolling: () => false });
  const asks = usePolledView(() => apiFetch(routes.asks.listAsks), { key: "asks", intervalMs: ASK_POLL_MS, keepPolling: () => false });
  const requests = usePolledView(() => apiFetch(routes.social.listFriendRequests), { key: "friend-requests", intervalMs: ASK_POLL_MS, keepPolling: () => false });
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
  const requestAnswers = useRequestAnswers(() => {
    requests.reload();
    friends.reload();
  });
  return { friends, requests, ...requestAnswers, asks, chosenPairId, isSending, formLine, sendError, choose, sendReactAsk };
}

// Accept and Decline for incoming requests: each posts to its route with the request id, then afterAnswer reads the lists again.
function useRequestAnswers(afterAnswer: () => void): { answer: RequestAnswerState; accept: (requestId: string) => Promise<void>; decline: (requestId: string) => Promise<void> } {
  const [answer, setAnswer] = useState<RequestAnswerState>({ busyId: null, error: null });
  const run = async (requestId: string, send: () => Promise<unknown>): Promise<void> => {
    setAnswer({ busyId: requestId, error: null });
    try {
      await send();
      setAnswer({ busyId: null, error: null });
      afterAnswer();
    } catch (thrown: unknown) {
      setAnswer({ busyId: null, error: asApiError(thrown) });
    }
  };
  return {
    answer,
    accept: (requestId) => run(requestId, () => apiFetch(routes.social.acceptFriendRequest, { params: { id: requestId } })),
    decline: (requestId) => run(requestId, () => apiFetch(routes.social.declineFriendRequest, { params: { id: requestId } })),
  };
}
