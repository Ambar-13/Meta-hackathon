// What exists: the api keeps one orchestrator thread per person, plans each message in the worker, and runs a plan when asked.
// The problem: the page must show a message at once, follow a thinking reply until it is planned, and start a plan only on a press.
// The step: these hooks read the thread (again every THREAD_POLL_MS while a reply thinks), the home view and the friends list, and
// hold the composer's text, the send and the plan runs. What it does not do: show anything; screen.tsx and its parts do.
import { useState } from "react";
import { ORCHESTRATOR_MESSAGE_MAX_CHARS, type FriendsView, type HomeView, type OrchestratorMessage, type OrchestratorThread } from "@meet-first/contracts";
import { apiFetch, asApiError, DRAFT_QUERY, routes, usePolledView, type ApiError, type PolledView } from "../../app-shell/index.js";
import { shouldPollThread, shownMessages, THREAD_POLL_MS } from "./chat-words.js";

// The draft a link put in the page's query, cut to the longest message, or null when there is none.
export function readDraftQuery(search: string): string | null {
  const value = new URLSearchParams(search).get(DRAFT_QUERY);
  if (value === null || value.trim() === "") return null;
  return value.slice(0, ORCHESTRATOR_MESSAGE_MAX_CHARS);
}

// The composer: its text, a count that goes up each time the page puts words in it (the box then takes the focus with the caret at
// the end), whether a send is out, the last send error, and the actions.
export type ComposerModel = {
  text: string;
  fillCount: number;
  isSending: boolean;
  sendError: ApiError | null;
  setText: (text: string) => void;
  fill: (text: string) => void;
  send: () => Promise<void>;
};

// One plan run as the page follows it: whether its request is out, and the error it came back with.
export type RunStatus = { isRunning: boolean; error: ApiError | null };

// The chat page's model: the polled thread, the messages as shown, the person's home view and friends, the composer and the plan runs.
export type ChatModel = {
  thread: PolledView<OrchestratorThread>;
  messages: OrchestratorMessage[];
  home: PolledView<HomeView>;
  friends: PolledView<FriendsView>;
  composer: ComposerModel;
  runStatus: (replyId: string) => RunStatus;
  runPlan: (replyId: string) => Promise<void>;
};

// Home and friends are read once when the page opens; a failed read is tried again after 30 s, as the polling hook does for any error.
const READ_ONCE = { intervalMs: 30_000, keepPolling: (): boolean => false } as const;
// The status of a plan that has not been pressed.
const IDLE_RUN: RunStatus = { isRunning: false, error: null };

// The two messages a 202 stands for, shown before the next thread read: the person's own, and the reply that is thinking.
function sentPair(text: string, reply: { messageId: string; replyId: string }): OrchestratorMessage[] {
  const createdAt = new Date().toISOString();
  const empty = { action: null, actionQuestion: null, actionFriendName: null, askId: null, createdAt } as const;
  return [
    { ...empty, id: reply.messageId, role: "you", text, state: "done" },
    { ...empty, id: reply.replyId, role: "agent", text: "", state: "thinking" },
  ];
}

// The composer's text and the send: POST /api/orchestrator, then the two messages at once, an empty box and a fresh thread read; an
// error keeps the text in the box.
function useComposer(draft: string | null, onSent: (messages: OrchestratorMessage[]) => void): ComposerModel {
  const [text, setText] = useState(draft ?? "");
  const [fillCount, setFillCount] = useState(draft === null ? 0 : 1);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const fill = (words: string): void => {
    setText(words.slice(0, ORCHESTRATOR_MESSAGE_MAX_CHARS));
    setFillCount((count) => count + 1);
  };
  const send = async (): Promise<void> => {
    const words = text.trim();
    if (words === "" || isSending) return;
    setSendError(null);
    setIsSending(true);
    try {
      const reply = await apiFetch(routes.social.sendToOrchestrator, { body: { text: words } });
      onSent(sentPair(words, reply));
      setText("");
    } catch (thrown: unknown) {
      setSendError(asApiError(thrown));
    } finally {
      setIsSending(false);
    }
  };
  return { text, fillCount, isSending, sendError, setText, fill, send };
}

// The plan runs: POST /api/orchestrator/:id/run, keeping the reply it returns so the card under it turns into the ask card or the refusal.
function usePlanRuns(): { ran: ReadonlyMap<string, OrchestratorMessage>; runStatus: (replyId: string) => RunStatus; runPlan: (replyId: string) => Promise<void> } {
  const [ran, setRan] = useState<ReadonlyMap<string, OrchestratorMessage>>(new Map());
  const [runs, setRuns] = useState<Readonly<Record<string, RunStatus>>>({});
  const runPlan = async (replyId: string): Promise<void> => {
    if (runs[replyId]?.isRunning === true) return;
    setRuns((previous) => ({ ...previous, [replyId]: { isRunning: true, error: null } }));
    try {
      const reply = await apiFetch(routes.social.runPlan, { params: { id: replyId } });
      setRan((previous) => new Map(previous).set(replyId, reply));
      setRuns((previous) => ({ ...previous, [replyId]: IDLE_RUN }));
    } catch (thrown: unknown) {
      const error = asApiError(thrown);
      setRuns((previous) => ({ ...previous, [replyId]: { isRunning: false, error } }));
    }
  };
  return { ran, runStatus: (replyId) => runs[replyId] ?? IDLE_RUN, runPlan };
}

// Reads the thread (again every THREAD_POLL_MS while a reply is thinking), the home view and the friends list, and holds the composer
// and the plan runs; draft is the text the composer starts with.
export function useChatScreen(draft: string | null): ChatModel {
  const thread = usePolledView(() => apiFetch(routes.social.readThread, {}), { key: "chat-thread", intervalMs: THREAD_POLL_MS, keepPolling: shouldPollThread });
  const home = usePolledView(() => apiFetch(routes.people.readHome, {}), { key: "chat-home", ...READ_ONCE });
  const friends = usePolledView(() => apiFetch(routes.directory.friends, {}), { key: "chat-friends", ...READ_ONCE });
  const [sent, setSent] = useState<readonly OrchestratorMessage[]>([]);
  const composer = useComposer(draft, (messages) => {
    setSent((previous) => [...previous, ...messages]);
    thread.reload();
  });
  const plans = usePlanRuns();
  const messages = shownMessages({ server: thread.value?.messages ?? [], ran: plans.ran, sent });
  return { thread, messages, home, friends, composer, runStatus: plans.runStatus, runPlan: plans.runPlan };
}
