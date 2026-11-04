// The messages of the thread, as Instagram draws a direct chat: your blue bubbles on the right,
// Meety's grey bubbles on the left from the edge, with its logo in line with its name over each run
// of its messages, a time line wherever the chat paused, and what each reply does by its state
// under its words: thinking dots, a plan card with its one button, the ask card, or a way to try
// again.
import { Fragment, type ReactElement } from "react";
import { HELP_SEND_COPY, type OrchestratorMessage } from "@meet-first/contracts";
import { MeetyMark } from "../../look/index.js";
import { AskCard, KindHead, WaitLine } from "./ask-card.js";
import type { RunStatus } from "./chat-state.js";
import { joinsPrevious, startsTimeLine, timeLineOf } from "./chat-words.js";

// The words of a reply that is still being planned.
export const THINKING_LINE = "Working out what to do";
// The line on a help search's card: the /help page's consent words, because pressing the button
// sends the question to up to 20 people, each of whom gets a copy with the person's display name.
const HELP_LINE = HELP_SEND_COPY;
// The words of a help search's button, which say what pressing it does.
const HELP_BUTTON = "Find who could help";
// The line under a reply whose ask is gone, for example because the friend deleted their account
// after it ran.
export const ASK_GONE_LINE = "This ask is no longer here. Send your message again to ask again.";
// The name a friend ask uses when the reply did not name the friend.
const FRIEND_FALLBACK = "your friend";

// What a reply needs from the page: whether its plan is being started, and the actions of its
// buttons.
export type ReplyActions = {
  runStatus: (replyId: string) => RunStatus;
  runPlan: (replyId: string) => void;
  tryAgain: (replyId: string) => void;
};
// Where a bubble sits in its group: whether it joins the bubble before it and the one after it, so
// its joined corners tuck in.
type GroupPlace = { joinsPrev: boolean; joinsNext: boolean };

// A sentence with its first letter in upper case, for a line that starts with a name.
function capitalised(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

// The line on a friend ask's card, and the words of its button, with the friend's name.
function reactWords(name: string | null): { line: string; button: string } {
  const who = name ?? FRIEND_FALLBACK;
  return {
    line: capitalised(
      `${who}'s Meety answers from what ${who} chose to share. ${capitalised(who)} gets a copy of the answer.`,
    ),
    button: `Ask ${who}'s Meety`,
  };
}

// The classes of a bubble by its place in its group.
function placeClass(base: string, place: GroupPlace): string {
  return [base, place.joinsPrev ? "joins-prev" : "", place.joinsNext ? "joins-next" : ""]
    .filter((part) => part !== "")
    .join(" ");
}

// Meety's logo in line with its name, over the first message of each run of its messages.
export const MeetyName = (): ReactElement => {
  return (
    <p className="chat-who">
      <MeetyMark />
      <span>Meety</span>
    </p>
  );
};

// The person's own message: a blue bubble on the right, with no name or picture.
const YouBubble = (props: { message: OrchestratorMessage; place: GroupPlace }): ReactElement => {
  return (
    <article className={placeClass("chat-you", props.place)} aria-label="You said">
      <p className="chat-text">{props.message.text}</p>
    </article>
  );
};

// A planned reply's card: the kind with its icon, the question in quotation marks, who it goes to,
// and the one button that starts it.
const PlanCard = (props: {
  message: OrchestratorMessage;
  status: RunStatus;
  onRun: () => void;
}): ReactElement => {
  const { message, status } = props;
  const isHelp = message.action === "help";
  const words = isHelp
    ? { line: HELP_LINE, button: HELP_BUTTON }
    : reactWords(message.actionFriendName);
  return (
    <>
      <section className="chat-card" aria-label="The plan">
        <KindHead
          mode={isHelp ? "help" : "react"}
          question={message.actionQuestion ?? ""}
          friendName={message.actionFriendName}
        />
        <p className="chat-card-line">{words.line}</p>
        <button
          type="button"
          className="chat-card-go"
          disabled={status.isRunning}
          onClick={props.onRun}
        >
          {status.isRunning ? "Starting" : words.button}
        </button>
      </section>
      {status.error === null ? null : (
        <p className="chat-run-error" role="alert">
          {status.error.message}
        </p>
      )}
    </>
  );
};

// Which part follows a reply's words: its plan card, its ask card, the line for an ask that is
// gone, Ask again, or nothing.
type ReplyStage = "plan" | "ask" | "gone" | "failed" | "none";

// The part that follows one reply, by its state and whether it still has its ask.
function replyStage(message: OrchestratorMessage): ReplyStage {
  const isAsk = message.action === "help" || message.action === "react";
  if (message.state === "planned" && isAsk) return "plan";
  if (message.askId !== null && (message.state === "running" || message.state === "done"))
    return "ask";
  if (message.state === "running" && isAsk) return "gone";
  return message.state === "failed" ? "failed" : "none";
}

// What follows a reply's words, by its stage: the plan card, the ask card, the line for an ask that
// is gone, or "Ask again".
const ReplyExtra = (props: {
  message: OrchestratorMessage;
  actions: ReplyActions;
}): ReactElement | null => {
  const { message, actions } = props;
  const stage = replyStage(message);
  if (stage === "plan")
    return (
      <PlanCard
        message={message}
        status={actions.runStatus(message.id)}
        onRun={() => {
          actions.runPlan(message.id);
        }}
      />
    );
  if (stage === "ask") {
    return (
      <AskCard
        askId={message.askId ?? ""}
        mode={message.action === "react" ? "react" : "help"}
        question={message.actionQuestion ?? ""}
        friendName={message.actionFriendName}
      />
    );
  }
  if (stage === "gone") return <p className="chat-ask-line">{ASK_GONE_LINE}</p>;
  if (stage === "failed") {
    return (
      <button
        type="button"
        className="quiet chat-again"
        onClick={() => {
          actions.tryAgain(message.id);
        }}
      >
        Ask again
      </button>
    );
  }
  return null;
};

// Meety's reply: its logo and name when the reply starts a run of its messages, its words in a grey
// bubble from the left edge (or the thinking dots in one), then what the reply does.
const AgentReply = (props: {
  message: OrchestratorMessage;
  actions: ReplyActions;
  place: GroupPlace;
}): ReactElement => {
  const { message, place } = props;
  return (
    <article className={placeClass("chat-agent", place)} aria-label="Meety replied">
      {place.joinsPrev ? null : <MeetyName />}
      {message.state === "thinking" ? (
        <div className="chat-bubble">
          <WaitLine text={THINKING_LINE} />
        </div>
      ) : (
        <p className="chat-bubble chat-text">{message.text}</p>
      )}
      <ReplyExtra message={message} actions={props.actions} />
    </article>
  );
};

// The thread: every message in order, a time line wherever the chat paused, in a log that screen
// readers follow politely.
export const Thread = (props: {
  messages: readonly OrchestratorMessage[];
  actions: ReplyActions;
}): ReactElement => {
  const { messages } = props;
  const now = new Date();
  return (
    <div className="chat-log" role="log" aria-live="polite" aria-label="Your chat with Meety">
      {messages.map((message, index) => {
        const place = {
          joinsPrev: joinsPrevious(messages, index),
          joinsNext: joinsPrevious(messages, index + 1),
        };
        return (
          <Fragment key={message.id}>
            {startsTimeLine(messages, index) ? (
              <p className="chat-time">{timeLineOf(message.createdAt, now)}</p>
            ) : null}
            {message.role === "you" ? (
              <YouBubble message={message} place={place} />
            ) : (
              <AgentReply message={message} actions={props.actions} place={place} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
};
