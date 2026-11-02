// The messages of the thread: the person's soft bubbles on the right, and the orchestrator's plain replies on the left with what each
// reply does by its state: thinking dots, a plan card with its one button, the ask card, or a way to try again.
import type { ReactElement } from "react";
import type { OrchestratorMessage } from "@meet-first/contracts";
import { Sticker } from "../../look/index.js";
import { AskCard, KindHead, WaitLine } from "./ask-card.js";
import type { RunStatus } from "./chat-state.js";

// The words of a reply that is still being planned.
export const THINKING_LINE = "Working out what to do";
// The line on a help search's card.
const HELP_LINE = "Your question goes to the agents of people in Explore. Each answers only from what its person chose to share.";
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
  return { line: capitalised(`${who}'s agent answers from what ${who} chose to share. ${capitalised(who)} gets a copy of the answer.`), button: `Ask ${who}'s agent` };
}

// The person's own message: a soft bubble on the right, with no avatar.
const YouBubble = (props: { message: OrchestratorMessage }): ReactElement => {
  return (
    <article className="chat-you" aria-label="You said">
      <p className="chat-text">{props.message.text}</p>
    </article>
  );
};

// A planned reply's card: the kind, the question in quotation marks, who it goes to, and the one button that starts it.
const PlanCard = (props: { message: OrchestratorMessage; status: RunStatus; onRun: () => void }): ReactElement => {
  const { message, status } = props;
  const isHelp = message.action === "help";
  const words = isHelp ? { line: HELP_LINE, button: "Start the help search" } : reactWords(message.actionFriendName);
  return (
    <>
      <section className="chat-card" aria-label="The plan">
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

// What follows a reply's words, by its state: the plan card, the ask card, or "Try again".
const ReplyExtra = (props: { message: OrchestratorMessage; actions: ReplyActions }): ReactElement | null => {
  const { message, actions } = props;
  const isAsk = message.action === "help" || message.action === "react";
  if (message.state === "planned" && isAsk) {
    return <PlanCard message={message} status={actions.runStatus(message.id)} onRun={() => { actions.runPlan(message.id); }} />;
  }
  if (message.askId !== null && (message.state === "running" || message.state === "done")) {
    return <AskCard askId={message.askId} mode={message.action === "react" ? "react" : "help"} question={message.actionQuestion ?? ""} />;
  }
  if (message.state === "failed") {
    return (
      <button type="button" className="quiet chat-again" onClick={() => { actions.tryAgain(message.id); }}>
        Try again
      </button>
    );
  }
  return null;
};

// The orchestrator's reply: the spark and its label, then the words as plain text (or the thinking dots), then what the reply does.
const AgentReply = (props: { message: OrchestratorMessage; actions: ReplyActions }): ReactElement => {
  const { message } = props;
  return (
    <article className="chat-agent" aria-label="The orchestrator replied">
      <Sticker name="spark" />
      <span className="chat-who">Orchestrator</span>
      <div className="chat-body">
        {message.state === "thinking" ? <WaitLine text={THINKING_LINE} /> : <p className="chat-text">{message.text}</p>}
        <ReplyExtra message={message} actions={props.actions} />
      </div>
    </article>
  );
};

// The thread: every message in order, in a log that screen readers follow politely.
export const Thread = (props: { messages: readonly OrchestratorMessage[]; actions: ReplyActions }): ReactElement => {
  return (
    <div className="chat-log" role="log" aria-live="polite" aria-label="Your chat with the orchestrator">
      {props.messages.map((message) =>
        message.role === "you" ? <YouBubble key={message.id} message={message} /> : <AgentReply key={message.id} message={message} actions={props.actions} />,
      )}
    </div>
  );
};
