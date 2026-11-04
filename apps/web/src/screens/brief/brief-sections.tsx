import type { ReactElement } from "react";
import { NO_RECEIPT_COPY, type BriefPoint, type Quote } from "@meet-first/contracts";
import { Sticker } from "../../look/index.js";
import { isWeakReceipt } from "./brief-state.js";

// How many characters of a quote a chip shows before the ellipsis (the chip copy in the screen
// table).
const CHIP_CHARACTERS = 40;
// The handler a chip calls with the line it came from and the quote it shows.
export type ShowQuote = (lineText: string, quote: Quote) => void;

// The letter that names a side on screen: A or B.
export function sideLetter(side: Quote["side"]): "A" | "B" {
  return side === "a" ? "A" : "B";
}

// The first 40 characters of a quote, with an ellipsis when the quote is longer.
function excerptOf(quote: Quote): string {
  const characters = Array.from(quote.text);
  return characters.length > CHIP_CHARACTERS
    ? `${characters.slice(0, CHIP_CHARACTERS).join("")}…`
    : quote.text;
}

// The text of one quote chip: the side letter, then the first 40 characters, with an ellipsis when
// the quote is longer.
export function chipText(quote: Quote): string {
  return `${sideLetter(quote.side)}: ${excerptOf(quote)}`;
}

// One quote chip: the side's letter in its colour, the start of the quote, and the no-receipt words
// when it did not match.
const QuoteChip = (props: { quote: Quote; onOpen: () => void }): ReactElement => {
  const { quote } = props;
  const name = quote.verified ? chipText(quote) : `${chipText(quote)} ${NO_RECEIPT_COPY}`;
  return (
    <button
      type="button"
      className={`brief-chip side-${quote.side}`}
      onClick={props.onOpen}
      aria-label={name}
    >
      <span className="brief-chip-side" aria-hidden="true">
        {sideLetter(quote.side)}
      </span>
      <q>{excerptOf(quote)}</q>
      {quote.verified ? null : <span className="brief-chip-flag">{NO_RECEIPT_COPY}</span>}
    </button>
  );
};

// One line of a brief: its text, the weak receipt mark when the check did not back it, and one chip
// per quote.
export const BriefLine = (props: { point: BriefPoint; onQuote: ShowQuote }): ReactElement => {
  const isWeak = isWeakReceipt(props.point);
  return (
    <li className={isWeak ? "brief-line weak" : "brief-line"}>
      <p>{props.point.text}</p>
      {isWeak ? (
        <span role="note" className="mark weak">
          weak quote
        </span>
      ) : null}
      <div className="brief-chips">
        {props.point.quotes.map((quote, index) => (
          <QuoteChip
            key={`${String(index)}-${quote.turnId}`}
            quote={quote}
            onOpen={() => {
              props.onQuote(props.point.text, quote);
            }}
          />
        ))}
      </div>
    </li>
  );
};

// The colour and sticker of each part of a brief, in order: where you click, where you rub, what to
// settle first, set aside.
export type SectionTone = "agree" | "clash" | "first" | "aside";
// Each tone's colour class and sticker.
const TONES: Record<SectionTone, { colour: string; sticker: "smile" | "spark" | "ask" | "nope" }> =
  {
    agree: { colour: "c-green", sticker: "smile" },
    clash: { colour: "c-yellow", sticker: "spark" },
    first: { colour: "c-lilac", sticker: "ask" },
    aside: { colour: "", sticker: "nope" },
  };

// One titled section of a brief, as a tilted colour panel with its lines in order; set-aside lines
// sit on a quiet dashed panel.
export const BriefSection = (props: {
  title: string;
  points: BriefPoint[];
  onQuote: ShowQuote;
  tone: SectionTone;
}): ReactElement => {
  const tone = TONES[props.tone];
  return (
    <section className={`brief-part brief-${props.tone} ${tone.colour}`}>
      <Sticker name={tone.sticker} />
      <h2>{props.title}</h2>
      <ul>
        {props.points.map((point, index) => (
          <BriefLine key={`${String(index)}-${point.text}`} point={point} onQuote={props.onQuote} />
        ))}
      </ul>
    </section>
  );
};
