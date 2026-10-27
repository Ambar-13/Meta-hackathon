// What exists: every claim of a persona answer has a quote, checked inside its named turn (verified) and, for verified claims, by
// the support check (supported). The problem: a reader must see when a quote did not check out, without colour and without any
// number about a person. The step: each claim shows its text, its quote and at most one receipt mark as text. What it does not do:
// show a position, a count or a rank (design section 10).
import type { ReactElement } from "react";
import { NO_RECEIPT_COPY, WEAK_RECEIPT_COPY, type AnswerClaim, type AskAnswer } from "@meet-first/contracts";
import { Avatar, Sticker } from "../../look/index.js";

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

// The flag of a claim whose quote is missing or weak: the receipt flag's look, with the mark as its only text and role note.
const ClaimFlag = (props: { mark: string }): ReactElement => {
  const isWeak = props.mark === WEAK_RECEIPT_COPY;
  return (
    <span className={isWeak ? "flag weak" : "flag"} role="note">
      {isWeak ? null : <Sticker name="nope" />}
      {props.mark}
    </span>
  );
};

// One answer's claims: each claim's text, its quote as a receipt card, and its receipt mark as text with role note; or the line that
// it has none. A flagged claim's quote card is dashed, so a claim without a backed quote looks different from one with it.
export const AnswerClaims = (props: { claims: AnswerClaim[] }): ReactElement => {
  if (props.claims.length === 0) return <p className="muted ask-no-claims">{NO_CLAIMS_LINE}</p>;
  return (
    <ul className="ask-claims">
      {props.claims.map((claim, index) => {
        const mark = receiptMarkFor(claim);
        return (
          <li key={`${String(index)}-${claim.quote}`} className={mark === null ? "ask-claim" : "ask-claim is-flagged"}>
            <p className="ask-claim-text">{claim.text}</p>
            <blockquote className="receipt ask-quote">
              <Sticker name="quote" />
              {claim.quote}
            </blockquote>
            {mark === null ? null : <ClaimFlag mark={mark} />}
          </li>
        );
      })}
    </ul>
  );
};

// The meeting control of a meetable answer: the button when this phone knows an approved card, else the line that says how to get one.
const MeetControl = (props: { answerId: string; cardId: string | null; isBusy: boolean; onMeet: (answerId: string, cardId: string) => void }): ReactElement => {
  const { cardId } = props;
  if (cardId === null) return <p className="muted ask-no-card">{NO_CARD_LINE}</p>;
  return (
    <button type="button" className="ask-meet" disabled={props.isBusy} onClick={() => { props.onMeet(props.answerId, cardId); }}>
      {MEET_LABEL}
    </button>
  );
};

// One help answer: the persona's initial, display name and line, its answer in a blue bubble, its claims, and the meeting control when
// canMeet is true.
export const HelpAnswerItem = (props: { answer: AskAnswer; cardId: string | null; isBusy: boolean; onMeet: (answerId: string, cardId: string) => void }): ReactElement => {
  const { answer } = props;
  return (
    <li className="panel ask-answer">
      <div className="ask-answer-head">
        <Avatar name={answer.displayName} side="b" />
        <div>
          <h3>{answer.displayName}</h3>
          {answer.line === null ? null : <p className="muted">{answer.line}</p>}
        </div>
      </div>
      <p className="ask-answer-text">{answer.answer}</p>
      <AnswerClaims claims={answer.claims} />
      {answer.canMeet ? <MeetControl answerId={answer.answerId} cardId={props.cardId} isBusy={props.isBusy} onMeet={props.onMeet} /> : null}
    </li>
  );
};
