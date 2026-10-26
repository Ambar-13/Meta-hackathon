// What exists: every claim of a persona answer has a quote, checked inside its named turn (verified) and, for verified claims, by
// the support check (supported). The problem: a reader must see when a quote did not check out, without colour and without any
// number about a person. The step: each claim shows its text, its quote and at most one receipt mark as text. What it does not do:
// show a position, a count or a rank (design section 10).
import type { ReactElement } from "react";
import { NO_RECEIPT_COPY, WEAK_RECEIPT_COPY, type AnswerClaim, type AskAnswer } from "@meet-first/contracts";

// The line for an answer that carries no claim [confirm].
const NO_CLAIMS_LINE = "No quotes from their notes.";
// The line in place of the meeting button when this phone knows no approved card; the lobby has the same limit [confirm].
const NO_CARD_LINE = "Open your approved card on this phone first, then come back here to start a meeting.";
// The words of the meeting button (design section 7).
const MEET_LABEL = "Start a meeting";

// The receipt mark of one claim: no receipt when its quote was not found in the named turn, weak receipt when the support check did
// not back it or did not run, and none otherwise (design section 7). An unverified claim gets only the no receipt mark [confirm].
export function receiptMarkFor(claim: AnswerClaim): string | null {
  if (!claim.verified) return NO_RECEIPT_COPY;
  if (claim.supported !== true) return WEAK_RECEIPT_COPY;
  return null;
}

// One answer's claims: each claim's text, its quote, and its receipt mark as text with role note; or the line that it has none.
export const AnswerClaims = (props: { claims: AnswerClaim[] }): ReactElement => {
  if (props.claims.length === 0) return <p className="muted">{NO_CLAIMS_LINE}</p>;
  return (
    <ul>
      {props.claims.map((claim, index) => {
        const mark = receiptMarkFor(claim);
        return (
          <li key={`${String(index)}-${claim.quote}`}>
            <p>{claim.text}</p>
            <blockquote>{claim.quote}</blockquote>
            {mark === null ? null : (
              <span className="mark" role="note">
                {mark}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// The meeting control of a meetable answer: the button when this phone knows an approved card, else the line that says how to get one.
const MeetControl = (props: { answerId: string; cardId: string | null; isBusy: boolean; onMeet: (answerId: string, cardId: string) => void }): ReactElement => {
  const { cardId } = props;
  if (cardId === null) return <p className="muted">{NO_CARD_LINE}</p>;
  return (
    <button type="button" disabled={props.isBusy} onClick={() => { props.onMeet(props.answerId, cardId); }}>
      {MEET_LABEL}
    </button>
  );
};

// One help answer: the persona's display name and line, its answer and claims, and the meeting control when canMeet is true.
export const HelpAnswerItem = (props: { answer: AskAnswer; cardId: string | null; isBusy: boolean; onMeet: (answerId: string, cardId: string) => void }): ReactElement => {
  const { answer } = props;
  return (
    <li className="panel">
      <h3>{answer.displayName}</h3>
      {answer.line === null ? null : <p className="muted">{answer.line}</p>}
      <p>{answer.answer}</p>
      <AnswerClaims claims={answer.claims} />
      {answer.canMeet ? <MeetControl answerId={answer.answerId} cardId={props.cardId} isBusy={props.isBusy} onMeet={props.onMeet} /> : null}
    </li>
  );
};
