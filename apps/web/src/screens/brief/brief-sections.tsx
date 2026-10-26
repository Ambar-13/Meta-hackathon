import type { ReactElement } from "react";
import type { BriefPoint, Quote } from "@meet-first/contracts";
import { isWeakReceipt } from "./brief-state.js";

// How many characters of a quote a chip shows before the ellipsis (the chip copy in the screen table).
const CHIP_CHARACTERS = 40;
// The smallest size a tap target may be, in pixels, so a thumb can hit it on a phone.
const TAP_TARGET_PX = 44;
// The handler a chip calls with the line it came from and the quote it shows.
export type ShowQuote = (lineText: string, quote: Quote) => void;

// The letter that names a side on screen: A or B.
export function sideLetter(side: Quote["side"]): "A" | "B" {
  return side === "a" ? "A" : "B";
}

// The text of one quote chip: the side letter, then the first 40 characters, with an ellipsis when the quote is longer.
export function chipText(quote: Quote): string {
  const characters = Array.from(quote.text);
  const excerpt = characters.length > CHIP_CHARACTERS ? `${characters.slice(0, CHIP_CHARACTERS).join("")}…` : quote.text;
  return `${sideLetter(quote.side)}: ${excerpt}`;
}

// One line of a brief: its text, the weak receipt mark when the check did not back it, and one chip per quote.
export const BriefLine = (props: { point: BriefPoint; onQuote: ShowQuote }): ReactElement => {
  const isWeak = isWeakReceipt(props.point);
  return (
    <li style={{ borderLeft: isWeak ? "3px dotted currentColor" : "none", paddingLeft: isWeak ? 12 : 0, marginBottom: 16 }}>
      <p>{props.point.text}</p>
      {isWeak ? <span role="note">weak receipt</span> : null}
      <div>
        {props.point.quotes.map((quote, index) => (
          <button key={`${String(index)}-${quote.turnId}`} type="button" onClick={() => {
              props.onQuote(props.point.text, quote);
            }} style={{ minHeight: TAP_TARGET_PX, marginRight: 8, marginTop: 8 }}>
            {chipText(quote)}
            {quote.verified ? null : <span aria-label="no receipt"> no receipt</span>}
          </button>
        ))}
      </div>
    </li>
  );
};

// One titled section of a brief, with its lines in order.
export const BriefSection = (props: { title: string; points: BriefPoint[]; onQuote: ShowQuote }): ReactElement => {
  return (
    <section>
      <h2>{props.title}</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {props.points.map((point, index) => (
          <BriefLine key={`${String(index)}-${point.text}`} point={point} onQuote={props.onQuote} />
        ))}
      </ul>
    </section>
  );
};
