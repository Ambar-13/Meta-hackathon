import { useEffect, useRef, useState, type ReactElement } from "react";
import { NO_RECEIPT_COPY, RECALL_SWITCH_COPY, type CardItem, type CardItemSource } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, ErrorNotice, routes } from "../../app-shell/index.js";
import { KIND_LABELS } from "./card-state.js";

// The source message state of the quote sheet: loading, loaded, or failed.
type SourceState = { kind: "loading" } | { kind: "loaded"; source: CardItemSource } | { kind: "failed"; error: ApiError };

// The message with the quote marked: the text before the highlight, the highlight, and the text after it.
const MessageText = (props: { source: CardItemSource }): ReactElement => {
  const { text, highlight } = props.source;
  if (highlight === null) return <p className="source-message">{text}</p>;
  const start = Math.min(highlight.start, text.length);
  const end = Math.min(Math.max(highlight.end, start), text.length);
  return (
    <p className="source-message">
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </p>
  );
};

// The tapped quote in a sheet that holds focus until Close, showing the message it came from with the quote marked (R3.2).
export const QuoteSheet = (props: { cardId: string; item: CardItem; onClose: () => void }): ReactElement => {
  const [source, setSource] = useState<SourceState>({ kind: "loading" });
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const { cardId, item } = props;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let isActive = true;
    apiFetch(routes.cards.readItemSource, { params: { id: cardId, position: String(item.position) } }).then(
      (value) => {
        if (isActive) setSource({ kind: "loaded", source: value });
      },
      (thrown: unknown) => {
        if (isActive) setSource({ kind: "failed", error: asApiError(thrown) });
      },
    );
    return () => {
      isActive = false;
    };
  }, [cardId, item.position]);

  return (
    <div className="panel" role="dialog" aria-modal="true" aria-labelledby="quote-title">
      <h2 id="quote-title">The quote</h2>
      {source.kind === "loading" ? <p className="muted">Loading the message.</p> : null}
      {source.kind === "loaded" ? <MessageText source={source.source} /> : null}
      {source.kind === "failed" ? <ErrorNotice error={source.error} /> : null}
      <p className="muted">{item.verified ? "Found word for word in your message." : "This quote did not match your message."}</p>
      <button type="button" className="quiet" ref={closeRef} onClick={props.onClose}>
        Close
      </button>
    </div>
  );
};

// The items, each with its kind, claim, English gloss when needed, quote button and approve box (R7.1, R6.5).
export const CardItemList = (props: { cardId: string; items: CardItem[]; ticked: ReadonlySet<string>; isLocked: boolean; onToggle: (itemId: string) => void }): ReactElement => {
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = props.items.find((item) => item.id === openId);
  return (
    <>
    <ul>
      {props.items.map((item) => (
        <li className="panel" key={item.id}>
          <p>
            <strong>{KIND_LABELS[item.kind]}</strong>: <span>{item.claim}</span>
          </p>
          {item.lang.startsWith("en") ? null : <p className="muted">{`In English: ${item.gloss}`}</p>}
          <button type="button" className="quiet" onClick={() => { setOpenId(item.id); }}>
            Show the quote
          </button>
          {item.verified ? null : <span className="mark">{NO_RECEIPT_COPY}</span>}
          {item.approved ? (
            <p className="muted">In your card</p>
          ) : (
            <label className="inline">
              <input type="checkbox" checked={props.ticked.has(item.id)} disabled={!item.verified || props.isLocked} onChange={() => { props.onToggle(item.id); }} />
              Use this in meetings
            </label>
          )}
        </li>
      ))}
    </ul>
      {openItem === undefined ? null : <QuoteSheet cardId={props.cardId} item={openItem} onClose={() => { setOpenId(null); }} />}
    </>
  );
};

// The explicit recall switch with its copy verbatim, off by default (R7.1).
export const RecallSwitch = (props: { isOn: boolean; isLocked: boolean; onChange: (isOn: boolean) => void }): ReactElement => {
  return (
    <label className="inline">
      <input type="checkbox" role="switch" checked={props.isOn} disabled={props.isLocked} onChange={(event) => { props.onChange(event.target.checked); }} />
      {RECALL_SWITCH_COPY}
    </label>
  );
};
