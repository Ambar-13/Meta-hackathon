import { useEffect, useLayoutEffect, useRef, type ReactElement } from "react";
import type { Claim, Phase } from "@meet-first/contracts";
import { Avatar, Receipt, ReceiptFlag, TypingDots } from "../../look/index.js";
import { SafeMarkdown, type MeetingFoldState, type Side, type TimelineItem, claimNeedsMark } from "../../transcript/index.js";

// How close to the bottom counts as at the bottom for autoscroll, 80 px [confirm] (the inputs say only "at the bottom").
export const AT_BOTTOM_PX = 80;
// The words for each phase [confirm] (drafted copy, no input gives it).
export const PHASE_LABELS: Record<Phase, string> = { open: "Opening", explore: "Exploring", decide: "Deciding", close: "Closing" };

// A side's display name from meeting.started, or the side letter in capitals when the meeting has not started.
export function speakerName(fold: MeetingFoldState, side: Side): string {
  return fold.started?.members.find((member) => member.side === side)?.displayName ?? side.toUpperCase();
}

// One timeline line for the items that are not turns: a phase change, a look in the notes, a point accepted or kept.
function renderLine(fold: MeetingFoldState, item: Exclude<TimelineItem, { kind: "turn" }>): ReactElement {
  const name = item.kind === "phase" ? "" : speakerName(fold, item.side);
  let text = "";
  if (item.kind === "phase") text = `Phase: ${PHASE_LABELS[item.phase]}`;
  if (item.kind === "recall") text = `${name}'s persona looked in its notes for: ${item.query}`;
  if (item.kind === "recall_result") text = item.found === 1 ? `${name}'s persona found 1 note.` : `${name}'s persona found ${String(item.found)} notes.`;
  if (item.kind === "concede") text = `${name}'s persona accepted a point: ${item.reason}`;
  if (item.kind === "hold") text = `${name}'s persona kept its position: ${item.reason}`;
  return <p className="timeline-line" key={item.seq}>{text}</p>;
}

// One quote a persona leaned on: the quote card, and the no-receipt flag when it was not found in the person's own words (R6.5).
const ClaimReceipt = (props: { claim: Claim; name: string }): ReactElement => {
  return (
    <>
      <Receipt quote={props.claim.quote} source={`${props.name}'s own words`} />
      {claimNeedsMark(props.claim) ? <ReceiptFlag isWeak={false} /> : null}
    </>
  );
};

// One finished turn as a bubble in its side's colour, with the persona's name, the text, and each quote under it (R6.5).
function renderTurn(fold: MeetingFoldState, item: Extract<TimelineItem, { kind: "turn" }>): ReactElement {
  const name = speakerName(fold, item.side);
  return (
    <article className={`msg ${item.side}`} key={item.seq} aria-label={`${name}'s persona`}>
      <Avatar name={name} side={item.side} />
      <div className="bubble">
        <h3 className="who">{`${name}'s persona`}</h3>
        <SafeMarkdown text={item.text} />
      </div>
      {item.claims.length === 0 ? null : (
        <div className="extra">
          {item.claims.map((claim) => (
            <ClaimReceipt key={claim.id} claim={claim} name={name} />
          ))}
        </div>
      )}
    </article>
  );
}

// The turn being written, as a dashed bubble that fills in as the words arrive.
const PartialTurn = (props: { fold: MeetingFoldState }): ReactElement | null => {
  const { partial } = props.fold;
  if (partial === null) return null;
  const name = speakerName(props.fold, partial.side);
  return (
    <article className={`msg ${partial.side}`} aria-live="polite" aria-label={`${name}'s persona is speaking`}>
      <Avatar name={name} side={partial.side} />
      <div className="bubble writing">
        <h3 className="who">{`${name}'s persona is speaking`}</h3>
        <SafeMarkdown text={partial.text} />
      </div>
    </article>
  );
};

// The meeting's lines in seq order, the turn being written, and the thinking line; follows new lines only for a reader at the bottom (R5.7, R6.5, R10.3).
export const TranscriptView = (props: { fold: MeetingFoldState; isThinkingNow: boolean }): ReactElement => {
  const { fold } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const isAtBottom = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const onScroll = (): void => {
      isAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_BOTTOM_PX;
    };
    element.addEventListener("scroll", onScroll);
    return () => {
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null && isAtBottom.current) element.scrollTop = element.scrollHeight;
  }, [fold.timeline.length, fold.partial?.text]);

  return (
    <div className="transcript" ref={ref}>
      <div className="talk">
        {fold.timeline.map((item) => (item.kind === "turn" ? renderTurn(fold, item) : renderLine(fold, item)))}
        <PartialTurn fold={fold} />
        {props.isThinkingNow ? (
          <p className="timeline-line">
            <TypingDots label="The personas are thinking" />
            Still thinking.
          </p>
        ) : null}
      </div>
    </div>
  );
};
