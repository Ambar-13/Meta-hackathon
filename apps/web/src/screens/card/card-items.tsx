import { useEffect, useRef, useState, type ReactElement } from "react";
import { RECALL_SWITCH_COPY, type CardItem, type CardItemSource } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, ErrorNotice, routes } from "../../app-shell/index.js";
import { EmptyState, LoadingLine, Receipt, ReceiptFlag, Sticker } from "../../look/index.js";
import { KIND_LABELS } from "./card-state.js";
import { PillSwitch } from "./pill-switch.js";

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

// The tapped quote in a sheet over the page that holds focus until Close, showing the message it came from with the quote marked (R3.2).
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
    <div className="quote-sheet-ground">
      <div className="panel quote-sheet" role="dialog" aria-modal="true" aria-labelledby="quote-title">
        <h2 id="quote-title">The quote</h2>
        {source.kind === "loading" ? <LoadingLine text="Loading the message." /> : null}
        {source.kind === "loaded" ? <MessageText source={source.source} /> : null}
        {source.kind === "failed" ? <ErrorNotice error={source.error} /> : null}
        <p className="muted">{item.verified ? "Found word for word in your message." : "This quote did not match your message."}</p>
        <button type="button" className="quiet" ref={closeRef} onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

// The colour of each item kind's chip. Coral and blue are the two voices of a meeting, so they go to the kinds seen least.
const KIND_COLOUR: Record<CardItem["kind"], string> = { value: "c-green", preference: "c-lilac", habit: "c-yellow", boundary: "c-coral", goal: "c-blue" };

// The mark under a quote: checked, weak, or none found (R6.5).
const QuoteMark = (props: { item: CardItem }): ReactElement => {
  if (!props.item.verified) return <ReceiptFlag isWeak={false} />;
  if (props.item.flagged) return <ReceiptFlag isWeak />;
  return (
    <span className="quote-checked">
      <Sticker name="check" />
      Quote checked
    </span>
  );
};

// The foot of one row: In your card once approved, or the box that keeps it, which only a checked quote may tick.
const UseBox = (props: { item: CardItem; isTicked: boolean; isLocked: boolean; onToggle: () => void }): ReactElement => {
  if (props.item.approved) return <span className="in-card">In your card</span>;
  return (
    <label className="use-box">
      <input type="checkbox" checked={props.isTicked} disabled={!props.item.verified || props.isLocked} onChange={props.onToggle} />
      Use this in meetings
    </label>
  );
};

// One item: its kind as a chip, the claim, an English gloss when needed, the quote that opens its message, its mark and its box.
const CardItemRow = (props: { item: CardItem; isTicked: boolean; isLocked: boolean; onOpen: () => void; onToggle: () => void }): ReactElement => {
  const { item } = props;
  return (
    <li className={item.verified ? "card-item" : "card-item is-flagged"}>
      <span className={`kind-chip ${KIND_COLOUR[item.kind]}`}>{KIND_LABELS[item.kind]}</span>
      <p className="card-claim">{item.claim}</p>
      {item.lang.startsWith("en") ? null : <p className="card-gloss">{`In English: ${item.gloss}`}</p>}
      <button type="button" className="receipt-open" aria-label="Show the quote" onClick={props.onOpen}>
        <Receipt quote={item.quote} source={item.verified ? "Your own words. Tap to see the message." : "Not found in your message. Tap to check."} />
      </button>
      <div className="card-item-foot">
        <QuoteMark item={item} />
        <UseBox item={item} isTicked={props.isTicked} isLocked={props.isLocked} onToggle={props.onToggle} />
      </div>
    </li>
  );
};

// The items, each with its kind, claim, English gloss when needed, quote and approve box (R7.1, R6.5).
export const CardItemList = (props: { cardId: string; items: CardItem[]; ticked: ReadonlySet<string>; isLocked: boolean; onToggle: (itemId: string) => void }): ReactElement => {
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = props.items.find((item) => item.id === openId);
  if (props.items.length === 0) {
    return <EmptyState sticker="lens" title="Nothing on this card">Your Meety found nothing it could back with a quote. Try a longer chat.</EmptyState>;
  }
  return (
    <>
      <ul className="card-items">
        {props.items.map((item) => (
          <CardItemRow
            key={item.id}
            item={item}
            isTicked={props.ticked.has(item.id)}
            isLocked={props.isLocked}
            onOpen={() => { setOpenId(item.id); }}
            onToggle={() => { props.onToggle(item.id); }}
          />
        ))}
      </ul>
      {openItem === undefined ? null : <QuoteSheet cardId={props.cardId} item={openItem} onClose={() => { setOpenId(null); }} />}
    </>
  );
};

// The explicit recall switch with its copy verbatim, off by default (R7.1).
export const RecallSwitch = (props: { isOn: boolean; isLocked: boolean; onChange: (isOn: boolean) => void }): ReactElement => {
  return (
    <div className="recall">
      <PillSwitch label={RECALL_SWITCH_COPY} isOn={props.isOn} isDisabled={props.isLocked} onChange={props.onChange} />
    </div>
  );
};
