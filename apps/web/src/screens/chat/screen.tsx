// What exists: the orchestrator plans one thing for each message, and the api runs that plan only when the person presses its button.
// The problem: the signed-in home must feel like a chat, show what each reply will do before anything goes to another agent, and fill
// in the ask as the agents answer. The step: this page is one centred column, the thread, then the big composer at the bottom; an
// empty thread shows a greeting and three example chips. What it does not do: wire itself to /home (the integrator does) or draw the
// rail and tabs (the frame does).
import "./chat.css";
import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import type { HomeView } from "@meet-first/contracts";
import { ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { LoadingLine, MeetyMark, Sticker } from "../../look/index.js";
import { nextStepOf } from "../home/home-state.js";
import { readDraftQuery, useChatScreen, type ChatModel } from "./chat-state.js";
import { chipTexts, greetingOf, messageBefore } from "./chat-words.js";
import { Composer } from "./composer.js";
import { Thread, type ReplyActions } from "./thread-parts.js";
import { FriendsRow, HomeSide } from "./home-parts.js";

// The lines of this page that the design gives word for word, and the loading line it does not.
const UNDER_GREETING = "Ask who could help you with something, or how a friend would probably react to something.";
const LOADING_LINE = "Loading your chat.";

// Today's next step while the person has no approved card, as one quiet panel with its link.
const NextStep = (props: { home: HomeView }): ReactElement | null => {
  if (props.home.card?.state === "approved") return null;
  const step = nextStepOf(props.home);
  return (
    <section className="soft-panel chat-next" aria-label="Your next step">
      <Sticker name={step.sticker} />
      <p>
        <strong>{step.title}</strong> {step.text}
      </p>
      <Link className="btn quiet" to={step.action.to}>{step.action.label}</Link>
    </section>
  );
};

// The empty thread: Meety's mark, the greeting as the page's visual title with the person's name in coral, and the line under it.
const Greeting = (props: { displayName: string | null }): ReactElement => {
  const name = props.displayName?.trim() ?? "";
  const text = greetingOf(name);
  const at = name === "" ? -1 : text.indexOf(name);
  return (
    <div className="chat-hello">
      <MeetyMark size="l" />
      <h2 className="chat-greeting" aria-label={text}>
        {at < 0 ? text : (
          <>
            {text.slice(0, at)}
            <span className="chat-greeting-name">{name}</span>
            {text.slice(at + name.length)}
          </>
        )}
      </h2>
      <p>{UNDER_GREETING}</p>
    </div>
  );
};

// The colour of each example chip, in order: a help search is yellow everywhere, and the two friend asks take the two voices.
const CHIP_TINTS = ["c-yellow", "c-coral", "c-blue"] as const;

// The three example chips under the composer; pressing one fills the box and never sends.
const Chips = (props: { model: ChatModel }): ReactElement => {
  const texts = chipTexts(props.model.friends.value?.friends ?? null);
  return (
    <div className="chat-chips" role="group" aria-label="Examples to start from">
      {texts.map((text, index) => (
        <button key={text} type="button" className={`chat-chip ${CHIP_TINTS[index] ?? "c-blue"}`} onClick={() => { props.model.composer.fill(text); }}>
          {text}
        </button>
      ))}
    </div>
  );
};

// How long after the newest message changes the page keeps to the end while parts above it grow, such as an ask card filling in.
const KEEP_AT_END_MS = 1_500;

// Scrolls the end of the chat into view; it jumps under reduced motion or when asked to.
function scrollToEnd(target: HTMLElement, isInstant: boolean): void {
  if (typeof target.scrollIntoView !== "function") return;
  const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "end", behavior: isReduced || isInstant ? "auto" : "smooth" });
}

// Scrolls to the end of the chat when the page loads (a jump), on a send and when a reply arrives, and keeps to the end for a moment
// while cards above it fill in.
function useScrollToNewest(key: string): RefObject<HTMLDivElement | null> {
  const end = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  useEffect(() => {
    const target = end.current;
    if (key === "" || target === null) return undefined;
    scrollToEnd(target, !hasScrolled.current);
    hasScrolled.current = true;
    const root = target.parentElement;
    if (root === null || typeof ResizeObserver !== "function") return undefined;
    const until = Date.now() + KEEP_AT_END_MS;
    const observer = new ResizeObserver(() => {
      if (Date.now() < until) scrollToEnd(target, true);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [key]);
  return end;
}

// The actions the replies' buttons call.
function replyActions(model: ChatModel): ReplyActions {
  return {
    runStatus: model.runStatus,
    runPlan: (replyId) => { void model.runPlan(replyId); },
    tryAgain: (replyId) => { void model.composer.resend(messageBefore(model.messages, replyId) ?? ""); },
  };
}

// The thread read: the loading line, or the error with a way to read again.
const ThreadState = (props: { model: ChatModel }): ReactElement | null => {
  const { thread } = props.model;
  if (thread.error !== null) {
    return (
      <div className="chat-thread-error">
        <ErrorNotice error={thread.error} />
        <button type="button" className="quiet" onClick={thread.reload}>Try again</button>
      </div>
    );
  }
  return thread.value === null ? <LoadingLine text={LOADING_LINE} /> : null;
};

// The class of the page's root: chat, plus is-ready once the thread is read and is-empty when it holds nothing.
function rootClass(isReady: boolean, isEmpty: boolean): string {
  return ["chat", isReady ? "is-ready" : "", isEmpty ? "is-empty" : ""].filter((part) => part !== "").join(" ");
}

// The key that changes when the newest message changes: on load, on a send and when a reply arrives.
function newestKey(messages: ChatModel["messages"]): string {
  const last = messages.at(-1);
  return last === undefined ? "" : `${String(messages.length)}:${last.id}:${last.state}`;
}

// The chat itself: the next step while there is no approved card, the greeting or the thread, the box, and the chips.
const ChatColumn = (props: { model: ChatModel; isEmpty: boolean; end: RefObject<HTMLDivElement | null> }): ReactElement => {
  const { model, isEmpty } = props;
  const home = model.home.value;
  return (
    <div className={rootClass(model.thread.value !== null, isEmpty)}>
      {home === null ? null : <NextStep home={home} />}
      {isEmpty ? <Greeting displayName={home?.displayName ?? null} /> : null}
      {model.messages.length > 0 ? <Thread messages={model.messages} actions={replyActions(model)} /> : null}
      <ThreadState model={model} />
      <Composer model={model.composer} />
      {isEmpty ? <Chips model={model} /> : null}
      <div className="chat-end" ref={props.end} />
    </div>
  );
};

// The chat page: the next step while there is no approved card, the greeting or the thread, the composer, and the chips.
export const ChatScreen = (): ReactElement => {
  const location = useLocation();
  const model = useChatScreen(readDraftQuery(location.search));
  const isEmpty = model.thread.value !== null && model.messages.length === 0;
  const end = useScrollToNewest(newestKey(model.messages));
  const friends = model.friends.value?.friends ?? null;
  const onAsk = (name: string): void => {
    model.composer.fill(`How would ${name} react to `);
  };
  return (
    <ScreenFrame title="Meety" isWide>
      <div className="home">
        <div className="home-main">
          <FriendsRow friends={friends ?? []} />
          <ChatColumn model={model} isEmpty={isEmpty} end={end} />
        </div>
        <HomeSide home={model.home.value} friends={friends} suggestions={model.suggestions.value?.listings ?? null} adds={model.adds} onAsk={onAsk} />
      </div>
    </ScreenFrame>
  );
};
