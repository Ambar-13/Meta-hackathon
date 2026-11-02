// The big rounded box at the bottom of the chat: a text box that grows to six lines, the Send pill inside it, the characters left near
// the limit, and the line that says nothing goes out until a reply's button is pressed.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement } from "react";
import { ORCHESTRATOR_MESSAGE_MAX_CHARS } from "@meet-first/contracts";
import { ErrorNotice } from "../../app-shell/index.js";
import { Icon } from "../../look/index.js";
import type { ComposerModel } from "./chat-state.js";
import { COUNTER_FROM_CHARS } from "./chat-words.js";

// The words in the empty box, and its name for screen readers (Ambar, 3 Nov: "have like the text ask meety our personal ai").
export const COMPOSER_LABEL = "Ask Meety, your personal AI";

// The most lines the box grows to before it scrolls.
const MAX_ROWS = 6;
// The line under the box.
const SAFETY_LINE = "Nothing goes to anyone's agent until you press the button on a reply.";

// The rows the box asks for, from the lines its text holds, for browsers that cannot size a text box to its content.
function rowsOf(text: string): number {
  return Math.min(MAX_ROWS, Math.max(1, text.split("\n").length));
}

// Enter sends, Shift and Enter makes a new line, and Enter does nothing while an input method is composing a character.
function onEnter(event: KeyboardEvent<HTMLTextAreaElement>, send: () => void): void {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  send();
}

// The composer: the box and its Send pill, the send error above it, and the line under it.
export const Composer = (props: { model: ComposerModel }): ReactElement => {
  const { model } = props;
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const used = model.text.length;
  const canSend = model.text.trim() !== "" && !model.isSending;

  useEffect(() => {
    const box = field.current;
    if (model.fillCount === 0 || box === null) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [model.fillCount]);

  const send = (): void => {
    if (canSend) void model.send();
  };
  return (
    <div className="chat-dock">
      {model.sendError === null ? null : <ErrorNotice error={model.sendError} />}
      <form
        className="chat-box"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="chat-hidden" htmlFor={fieldId}>{COMPOSER_LABEL}</label>
        <textarea
          id={fieldId}
          ref={field}
          rows={rowsOf(model.text)}
          maxLength={ORCHESTRATOR_MESSAGE_MAX_CHARS}
          placeholder={COMPOSER_LABEL}
          value={model.text}
          onChange={(event) => { model.setText(event.target.value); }}
          onKeyDown={(event) => { onEnter(event, send); }}
        />
        <div className="chat-box-row">
          {used > COUNTER_FROM_CHARS ? <span className="chat-left">{`${String(ORCHESTRATOR_MESSAGE_MAX_CHARS - used)} left`}</span> : null}
          <button type="submit" className="chat-send" disabled={!canSend}>
            {model.isSending ? "Sending" : "Send"}
            <Icon name="send" size={18} isBold />
          </button>
        </div>
      </form>
      <p className="chat-safety">{SAFETY_LINE}</p>
    </div>
  );
};
