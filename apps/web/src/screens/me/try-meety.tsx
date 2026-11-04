import { useId, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  APP_PATHS,
  apiFetch,
  asApiError,
  ErrorNotice,
  routes,
  type ApiError,
} from "../../app-shell/index.js";

// The words of Try your Meety.
const TRY_COPY = {
  title: "Try your Meety",
  lede: "Ask it something about you, the way a friend would, and see how it answers.",
  label: "Ask your Meety about you",
  placeholder: "How would I react if a friend cancelled our trip?",
  ask: "Ask my Meety",
  asking: "Asking",
  short: "Write a question of at least 5 characters.",
} as const;
// The fewest characters a question may have, as POST /api/asks counts them.
const QUESTION_MIN_CHARACTERS = 5;

// Where a question to your own Meety stands: not sent, sending, refused before any request, or failed.
type TryState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "refused"; sentence: string }
  | { kind: "failed"; error: ApiError };

// Sends a self ask with POST /api/asks and opens its page, where the answer shows as a friend ask's does.
function useSelfAsk(): { state: TryState; send: (text: string) => Promise<void> } {
  const navigate = useNavigate();
  const [state, setState] = useState<TryState>({ kind: "idle" });
  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (Array.from(trimmed).length < QUESTION_MIN_CHARACTERS) {
      setState({ kind: "refused", sentence: TRY_COPY.short });
      return;
    }
    setState({ kind: "sending" });
    try {
      const reply = await apiFetch(routes.asks.createAsk, {
        body: { mode: "self", text: trimmed },
      });
      navigate(APP_PATHS.ask(reply.askId));
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return { state, send };
}

// Try your Meety, on Me once there is a card or a checked summary: one question to your own Meety about you.
export const TryMeety = (): ReactElement => {
  const titleId = useId();
  const [text, setText] = useState("");
  const { state, send } = useSelfAsk();
  const isSending = state.kind === "sending";
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void send(text);
  };
  return (
    <section className="me-try" aria-labelledby={titleId}>
      <h2 id={titleId}>{TRY_COPY.title}</h2>
      <p className="me-try-lede">{TRY_COPY.lede}</p>
      <form onSubmit={onSubmit}>
        <label>
          <span>{TRY_COPY.label}</span>
          <textarea
            rows={2}
            maxLength={300}
            value={text}
            placeholder={TRY_COPY.placeholder}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </label>
        <div className="actions">
          <button type="submit" disabled={isSending}>
            {isSending ? TRY_COPY.asking : TRY_COPY.ask}
          </button>
        </div>
      </form>
      {state.kind === "refused" ? (
        <p className="me-try-note" role="alert">
          {state.sentence}
        </p>
      ) : null}
      {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
    </section>
  );
};
