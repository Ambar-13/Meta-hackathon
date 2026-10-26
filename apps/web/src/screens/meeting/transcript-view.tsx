import { useEffect, useLayoutEffect, useRef, type ReactElement } from "react";
import { NO_RECEIPT_COPY, type Phase } from "@meet-first/contracts";
import { SafeMarkdown, type MeetingFoldState, type Side, type TimelineItem, claimNeedsMark } from "../../transcript/index.js";

// How close to the bottom counts as at the bottom for autoscroll, 80 px [confirm] (the inputs say only "at the bottom").
export const AT_BOTTOM_PX = 80;
// The words for each phase [confirm] (drafted copy, no input gives it).
export const PHASE_LABELS: Record<Phase, string> = { open: "Opening", explore: "Exploring", decide: "Deciding", close: "Closing" };

// A side's display name from meeting.started, or the side letter in capitals when the meeting has not started.
export function speakerName(fold: MeetingFoldState, side: Side): string {
  return fold.started?.members.find((member) => member.side === side)?.displayName ?? side.toUpperCase();
}

// One timeline line for the items that are not turns.
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

// One finished turn with its claims and the no-receipt mark for each unverified one (R6.5).
function renderTurn(fold: MeetingFoldState, item: Extract<TimelineItem, { kind: "turn" }>): ReactElement {
  return (
    <article className="turn" key={item.seq}>
      <h3>{`${speakerName(fold, item.side)}'s persona`}</h3>
      <SafeMarkdown text={item.text} />
      <ul>
        {item.claims.map((claim) => (
          <li key={claim.id}>
            {`Quote: "${claim.quote}"`}
            {claimNeedsMark(claim) ? <span className="mark">{NO_RECEIPT_COPY}</span> : null}
          </li>
        ))}
      </ul>
    </article>
  );
}

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
      {fold.timeline.map((item) => (item.kind === "turn" ? renderTurn(fold, item) : renderLine(fold, item)))}
      {fold.partial === null ? null : (
        <article className="turn partial" aria-live="polite">
          <h3>{`${speakerName(fold, fold.partial.side)}'s persona is speaking`}</h3>
          <SafeMarkdown text={fold.partial.text} />
        </article>
      )}
      {props.isThinkingNow ? <p className="timeline-line">Still thinking.</p> : null}
    </div>
  );
};
