import type { ReactElement, ReactNode } from "react";
import { NO_RECEIPT_COPY, WEAK_RECEIPT_COPY, type QuestionKind } from "@meet-first/contracts";
import { Sticker, type StickerName } from "./stickers.js";

// The colours a name tag band can take: coral and blue are the two people in a meeting, green and
// lilac mark everyone else.
export type TagColour = "coral" | "blue" | "green" | "lilac";
// A meeting side as the voices use it: side a speaks in coral, side b in blue (docs/DESIGN.md "Two
// voices").
export type VoiceSide = "a" | "b";

// The "Hello, my name is" sticker with one name written on it. Size and tilt come from a class the
// screen sets on it. The band's words come from the stylesheet, so the tag adds no text a test or a
// screen reader could trip on.
export const NameTag = (props: {
  name: string;
  colour?: TagColour;
  className?: string;
}): ReactElement => {
  const colour = props.colour ?? "coral";
  const classes = ["tag", colour === "coral" ? "" : colour, props.className ?? ""]
    .filter((part) => part !== "")
    .join(" ");
  return (
    <span className={classes} aria-hidden="true">
      <span className="tag-band">
        <b />
        <i />
      </span>
      <span className="tag-name">{props.name}</span>
    </span>
  );
};

// How each kind of question looks wherever it is named: its words, its colour class and its sticker
// (docs/DESIGN.md "Colour").
export const KIND_LOOK: Record<
  QuestionKind,
  { label: string; colour: string; sticker: StickerName }
> = {
  get_along: { label: "Getting along", colour: "c-green", sticker: "smile" },
  help: { label: "Help", colour: "c-yellow", sticker: "buoy" },
  situation: { label: "A situation", colour: "c-lilac", sticker: "spark" },
  decision: { label: "A decision", colour: "c-coral", sticker: "ask" },
  deal: { label: "A deal", colour: "c-coral", sticker: "coins" },
  debate: { label: "A debate", colour: "c-lilac", sticker: "chat" },
  romance: { label: "A first date", colour: "c-blue", sticker: "cup" },
};

// The colour of each meeting side, as a colour class the avatar and bubbles read.
export const SIDE_COLOUR_CLASS: Record<VoiceSide, string> = { a: "c-coral", b: "c-blue" };

// The first letter of a display name for an avatar, or a dot when the name is empty.
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first === undefined ? "·" : first.toLocaleUpperCase();
}

// A person as a round initial in their side's colour, as the meeting screens show both people.
export const Avatar = (props: {
  name: string;
  side: VoiceSide;
  isSmall?: boolean;
}): ReactElement => {
  const size = props.isSmall === true ? " small" : "";
  return (
    <span className={`avatar ${SIDE_COLOUR_CLASS[props.side]}${size}`} aria-hidden="true">
      {initialOf(props.name)}
    </span>
  );
};

// One quote a line rests on, with where it came from. With onOpen it is a button that opens the
// source; without, plain text.
export const Receipt = (props: {
  quote: string;
  source: string;
  onOpen?: () => void;
}): ReactElement => {
  const body = (
    <>
      <Sticker name="quote" />
      <span>
        <q>{props.quote}</q>
        {props.source === "" ? null : <small>{props.source}</small>}
      </span>
    </>
  );
  if (props.onOpen === undefined) return <span className="receipt">{body}</span>;
  return (
    <button type="button" className="receipt" onClick={props.onOpen}>
      {body}
    </button>
  );
};

// The flag for a line with no quote, or with a quote the check did not support; the words come from
// contracts.
export const ReceiptFlag = (props: { isWeak: boolean }): ReactElement => {
  if (props.isWeak) {
    return (
      <span className="flag weak">
        <span>{WEAK_RECEIPT_COPY}</span>
      </span>
    );
  }
  return (
    <span className="flag">
      <Sticker name="nope" />
      <span>{NO_RECEIPT_COPY}</span>
      <span className="flag-more">, so treat it as a guess</span>
    </span>
  );
};

// Three slow dots in a bubble, for a persona that is writing; the label says who, for screen
// readers.
export const TypingDots = (props: { label: string }): ReactElement => {
  return (
    <span className="typing" role="status" aria-label={props.label}>
      <i />
      <i />
      <i />
    </span>
  );
};

// A screen or list with nothing in it yet: one sticker, one heading, one or two lines, and the next
// step.
export const EmptyState = (props: {
  sticker: StickerName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): ReactElement => {
  return (
    <section className="empty">
      <Sticker name={props.sticker} />
      <h2>{props.title}</h2>
      {props.children === undefined ? null : <p>{props.children}</p>}
      {props.action === undefined ? null : <div className="actions">{props.action}</div>}
    </section>
  );
};

// A waiting line with the typing dots before it, for any screen that is loading or working.
export const LoadingLine = (props: { text: string }): ReactElement => {
  return (
    <p className="loading" role="status">
      <span className="typing" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {props.text}
    </p>
  );
};
