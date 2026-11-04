// What exists: a person stuck on a problem can send it to the personas listed in the directory, and run_ask asks up to 20 of them.
//The problem: the person must see where the problem goes before sending it, because sending is their consent.
//The step: the box, HELP_SEND_COPY under it, and the send button; a sent search opens its answers page. What it does not do:
// check the question; run_ask does that before any persona sees it.
import "./help.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { HELP_SEND_COPY } from "@meet-first/contracts";
import {
  apiFetch,
  APP_PATHS,
  asApiError,
  ErrorNotice,
  routes,
  ScreenFrame,
  type ApiError,
} from "../../app-shell/index.js";
import { LoadingLine, Sticker } from "../../look/index.js";

// The label of the problem box; 5 to 300 characters is what AskCreate accepts after trimming.
const PROBLEM_LABEL = "Your problem";
// The fewest and the most characters of a problem, the bounds of AskCreate in contracts.
const PROBLEM_MIN_CHARACTERS = 5;
const PROBLEM_MAX_CHARACTERS = 300;
// The line shown when the problem is shorter or longer than that.
const PROBLEM_LENGTH_LINE = "Write a problem of 5 to 300 characters.";
// The words of the send button.
const SEND_LABEL = "Find who could help";
// The line shown while the problem is on its way (drafted copy, design pass).
const SENDING_LINE = "Asking the people in Explore.";

// The help page's send action: the length check, the POST, then the answers page; go navigates.
function useHelpSend(go: (path: string) => void): {
  isSending: boolean;
  lengthLine: string | null;
  sendError: ApiError | null;
  send: (text: string) => Promise<void>;
} {
  const [isSending, setIsSending] = useState(false);
  const [lengthLine, setLengthLine] = useState<string | null>(null);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    setSendError(null);
    if (trimmed.length < PROBLEM_MIN_CHARACTERS || trimmed.length > PROBLEM_MAX_CHARACTERS) {
      setLengthLine(PROBLEM_LENGTH_LINE);
      return;
    }
    setLengthLine(null);
    setIsSending(true);
    try {
      const reply = await apiFetch(routes.asks.createAsk, {
        body: { mode: "help", text: trimmed },
      });
      go(APP_PATHS.ask(reply.askId));
    } catch (thrown: unknown) {
      setSendError(asApiError(thrown));
      setIsSending(false);
    }
  };
  return { isSending, lengthLine, sendError, send };
}

// The /help page: the problem box, the words that say where the problem goes, and the send button.
export const HelpScreen = (): ReactElement => {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const help = useHelpSend((path) => {
    navigate(path);
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void help.send(text);
  };
  return (
    <ScreenFrame title="Find help">
      <form className="help-form" onSubmit={onSubmit}>
        <Sticker name="buoy" className="help-sticker" />
        <label>
          {PROBLEM_LABEL}
          <textarea
            maxLength={PROBLEM_MAX_CHARACTERS}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </label>
        {help.lengthLine === null ? null : (
          <p className="help-length" role="alert">
            {help.lengthLine}
          </p>
        )}
        <p className="help-where">{HELP_SEND_COPY}</p>
        <button type="submit" className="big" disabled={help.isSending}>
          {SEND_LABEL}
        </button>
      </form>
      {help.isSending ? <LoadingLine text={SENDING_LINE} /> : null}
      {help.sendError === null ? null : <ErrorNotice error={help.sendError} />}
    </ScreenFrame>
  );
};
