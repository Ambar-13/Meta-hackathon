import { useEffect, useRef, type KeyboardEvent, type ReactElement } from "react";
import { Avatar, Icon, Sticker } from "../../look/index.js";
import { sideLetter } from "./brief-sections.js";
import type { OpenQuote } from "./brief-state.js";

// The sheet that shows one tapped quote in full, with the sentence that says whether it matched its
// turn. It rises from the bottom of a phone and sits in the middle of a laptop, over a dimmed page.
export const QuoteSheet = (props: {
  sheet: OpenQuote | null;
  onClose: () => void;
}): ReactElement | null => {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (props.sheet !== null) closeButton.current?.focus();
  }, [props.sheet]);
  if (props.sheet === null) return null;
  const { quote } = props.sheet;
  const side = sideLetter(quote.side);
  const sentence = quote.verified
    ? `Said by side ${side}. Checked inside the named turn.`
    : `Said by side ${side}. This quote did not match the named turn.`;
  // The sheet has one control, so Tab stays on it, and Escape closes the sheet.
  const keepFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") props.onClose();
    if (event.key === "Tab") {
      event.preventDefault();
      closeButton.current?.focus();
    }
  };
  return (
    <div className="quote-scrim">
      <div
        className="quote-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-sheet-title"
        onKeyDown={keepFocus}
      >
        <Sticker name="quote" />
        <button
          ref={closeButton}
          type="button"
          className="quiet sheet-close"
          onClick={props.onClose}
          aria-label="Close"
        >
          <Icon name="close" size={22} />
        </button>
        <h2 id="quote-sheet-title">Quote</h2>
        <blockquote>{quote.text}</blockquote>
        <p className="quote-sheet-who">
          <Avatar name={side} side={quote.side} isSmall />
          {sentence}
        </p>
      </div>
    </div>
  );
};
