// The messages of the thread, as Instagram draws a direct chat: your blue bubbles on the right, and Meety's group on the left, its name
// over its grey bubble and its small logo at the foot, with what each reply does by its state under the words: thinking dots, a plan
// card with its one button, the ask card, or a way to try again.
import type { ReactElement } from "react";
import { HELP_SEND_COPY, type OrchestratorMessage } from "@meet-first/contracts";
import { MeetyMark } from "../../look/index.js";
import { AskCard, KindHead, kindTint, WaitLine } from "./ask-card.js";
import type { RunStatus } from "./chat-state.js";

// The words of a reply that is still being planned.
export const THINKING_LINE = "Working out what to do";
// The line on a help search's card: the /help page's consent words, because pressing the button sends the question to up to 20 people,
// each of whom gets a copy with the person's display name.
const HELP_LINE = HELP_SEND_COPY;
// The line under a reply whose ask is gone, for example because the friend deleted their account after it ran.
export const ASK_GONE_LINE = "This ask is no longer here. Send your message again to ask again.";
// The name a friend ask uses when the reply did not name the friend.
const FRIEND_FALLBACK = "your friend";

// What a reply needs from the page: whether its plan is being started, and the actions of its buttons.
export type ReplyActions = { runStatus: (replyId: string) => RunStatus; runPlan: (replyId: string) => void; tryAgain: (replyId: string) => void };

// A sentence with its first letter in upper case, for a line that starts with a name.
function capitalised(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

// The line on a friend ask's card, and the words of its button, with the friend's name.
function reactWords(name: string | null): { line: string; button: string } {
  const who = name ?? FRIEND_FALLBACK;
  return { line: capitalised(`${who}'s Meety answers from what ${who} chose to share. ${capitalised(who)} gets a copy of the answer.`), button: `Ask ${who}'s Meety` };
}

// The person's own message: a blue bubble on the right, with no avatar.
const YouBubble = (props: { message: OrchestratorMessage }): ReactElement => {
  return (
    <article className="chat-you" aria-label="You said">
      <p className="chat-text">{props.message.text}</p>
    </article>
  );
};

// A planned reply's card, in the kind's colour: the kind, the question in quotation marks, who it goes to, and the one button that
// starts it.
const PlanCard = (props: { message: OrchestratorMessage; status: RunStatus; onRun: () => void }): ReactElement => {
  const { message, status } = props;
  const isHelp = message.action === "help";
  const words = isHelp ? { line: HELP_LINE, button: "Start the help search" } : reactWords(message.actionFriendName);
  return (
    <>
      <section className={`chat-card ${kindTint(isHelp ? "help" : "react")}`} aria-label="The plan">
        <KindHead mode={isHelp ? "help" : "react"} question={message.actionQuestion ?? ""} />
        <p className="chat-card-line">{words.line}</p>
        <button type="button" disabled={status.isRunning} onClick={props.onRun}>
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

// Which part follows a reply's words: its plan card, its ask card, the line for an ask that is gone, Ask again, or nothing.
type ReplyStage = "plan" | "ask" | "gone" | "failed" | "none";

// The part that follows one reply, by its state and whether it still has its ask.
function replyStage(message: OrchestratorMessage): ReplyStage {
  const isAsk = message.action === "help" || message.action === "react";
  if (message.state === "planned" && isAsk) return "plan";
  if (message.askId !== null && (message.state === "running" || message.state === "done")) return "ask";
  if (message.state === "running" && isAsk) return "gone";
  return message.state === "failed" ? "failed" : "none";
}

// What follows a reply's words, by its stage: the plan card, the ask card, the line for an ask that is gone, or "Ask again".
const ReplyExtra = (props: { message: OrchestratorMessage; actions: ReplyActions }): ReactElement | null => {
  const { message, actions } = props;
  const stage = replyStage(message);
  if (stage === "plan") return <PlanCard message={message} status={actions.runStatus(message.id)} onRun={() => { actions.runPlan(message.id); }} />;
  if (stage === "ask") return <AskCard askId={message.askId ?? ""} mode={message.action === "react" ? "react" : "help"} question={message.actionQuestion ?? ""} />;
  if (stage === "gone") return <p className="chat-ask-line">{ASK_GONE_LINE}</p>;
  if (stage === "failed") {
    return (
      <button type="button" className="quiet chat-again" onClick={() => { actions.tryAgain(message.id); }}>
        Ask again
      </button>
    );
  }
  return null;
};

// Meety's reply: its name, its words in a grey bubble (or the thinking dots in one), then what the reply does, with its small logo at
// the foot of the group as Instagram puts a person's picture beside their last message.
const AgentReply = (props: { message: OrchestratorMessage; actions: ReplyActions }): ReactElement => {
  const { message } = props;
  return (
    <article className="chat-agent" aria-label="Meety replied">
      <MeetyMark />
      <div className="chat-agent-body">
        <span className="chat-who">Meety</span>
        {message.state === "thinking" ? (
          <div className="chat-bubble">
            <WaitLine text={THINKING_LINE} />
          </div>
        ) : <p className="chat-bubble chat-text">{message.text}</p>}
        <ReplyExtra message={message} actions={props.actions} />
      </div>
    </article>
  );
};

// The thread: every message in order, in a log that screen readers follow politely.
export const Thread = (props: { messages: readonly OrchestratorMessage[]; actions: ReplyActions }): ReactElement => {
  return (
    <div className="chat-log" role="log" aria-live="polite" aria-label="Your chat with Meety">
      {props.messages.map((message) =>
        message.role === "you" ? <YouBubble key={message.id} message={message} /> : <AgentReply key={message.id} message={message} actions={props.actions} />,
      )}
    </div>
  );
};
