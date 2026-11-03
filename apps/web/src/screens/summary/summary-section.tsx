import "./summary.css";
import { useId, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { SUMMARY_MAX_CHARS, type SummaryPoint, type SummaryView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice } from "../../app-shell/index.js";
import { LoadingLine } from "../../look/index.js";
import { PillSwitch } from "../card/pill-switch.js";
import { SUMMARY_PROMPT, type SummaryHook } from "./summary-state.js";

// The words of the summary section.
const SUMMARY_COPY = {
  title: "Your AI's summary of you",
  lede: "ChatGPT or Claude already knows you. Copy the prompt, paste it into a chat there, then paste its answer here. You see every point before it is saved.",
  loading: "Opening your summary.",
  copy: "Copy the prompt",
  copied: "Copied. Paste it into ChatGPT or Claude.",
  refused: "This browser did not let us copy. Select the prompt below and copy it.",
  promptLabel: "The prompt",
  answerLabel: "Your AI's answer",
  noPoints: "No points found in this text. Paste the whole answer, from its first Kind line to the end.",
  tooLong: `These points come to more than ${SUMMARY_MAX_CHARS.toLocaleString("en-US")} characters. Remove some, then save.`,
  friends: "Friends' asks can use my summary",
  save: "Save summary",
  saving: "Saving",
  checking: "Checking your summary against your chats.",
  failed: "Your summary could not be checked. Paste it again to try once more.",
  friendsOn: "Friends' asks can use this summary.",
  friendsOff: "Only your own Meety uses this summary.",
  replace: "Paste a new summary",
  delete: "Delete summary",
  nudge: "Add your chats too. With them, your Meety can quote you and help your friends better.",
  addChats: "Add your chats",
} as const;

// "1 point" or "n points".
function pointWords(count: number): string {
  return `${String(count)} ${count === 1 ? "point" : "points"}`;
}

// What a saved summary's check says: still checking, failed, or how many points have a quote found in the person's chats.
function checkLine(view: SummaryView): string {
  if (view.state === "checking") return SUMMARY_COPY.checking;
  if (view.state === "failed") return SUMMARY_COPY.failed;
  const found = view.points.filter((point) => point.found !== null).length;
  return `${String(found)} of ${pointWords(view.points.length)} found in your chats.`;
}

// The points a paste gives, each with its first quote and a Remove button; the count names the list.
const PointList = (props: { points: SummaryPoint[]; onRemove: (index: number) => void }): ReactElement => {
  const countId = useId();
  return (
    <>
      <p id={countId} className="summary-count">{`${pointWords(props.points.length)} to save`}</p>
      <ul className="summary-points" aria-labelledby={countId}>
        {props.points.map((point, index) => (
          <li key={`${String(index)}:${point.point}`}>
            <div>
              <p className="summary-point">{point.point}</p>
              {point.quotes[0] === undefined ? null : <p className="summary-quote">{`“${point.quotes[0]}”`}</p>}
            </div>
            <button type="button" className="quiet" aria-label={`Remove this point: ${point.point}`} onClick={() => { props.onRemove(index); }}>Remove</button>
          </li>
        ))}
      </ul>
    </>
  );
};

// The copy button, what it did, and the prompt itself when the browser would not copy it.
const CopyPrompt = (props: { summary: SummaryHook }): ReactElement => {
  const { copy } = props.summary;
  return (
    <div className="summary-copy">
      <button type="button" onClick={() => void props.summary.copyPrompt()}>{SUMMARY_COPY.copy}</button>
      <p role="status" className="summary-status">{copy === "copied" ? SUMMARY_COPY.copied : null}{copy === "refused" ? SUMMARY_COPY.refused : null}</p>
      {copy === "refused" ? (
        <label className="summary-field">
          <span>{SUMMARY_COPY.promptLabel}</span>
          <textarea readOnly rows={8} value={SUMMARY_PROMPT} onFocus={(event) => { event.target.select(); }} />
        </label>
      ) : null}
    </div>
  );
};

// What the paste gave: its points, or why there are none to save.
const PasteResult = (props: { summary: SummaryHook }): ReactElement | null => {
  const { summary } = props;
  if (summary.draft.trim() === "") return null;
  if (summary.points.length === 0) return <p className="summary-note">{SUMMARY_COPY.noPoints}</p>;
  return (
    <>
      <PointList points={summary.points} onRemove={summary.removePoint} />
      {summary.isTooLong ? <p className="summary-note">{SUMMARY_COPY.tooLong}</p> : null}
    </>
  );
};

// The way in: copy the prompt, paste the answer, check its points, choose whether friends can ask, save.
const SummaryForm = (props: { summary: SummaryHook }): ReactElement => {
  const { summary } = props;
  const isSending = summary.send.kind === "sending";
  const canSave = summary.points.length > 0 && !summary.isTooLong && !isSending;
  return (
    <>
      <p className="summary-lede">{SUMMARY_COPY.lede}</p>
      <CopyPrompt summary={summary} />
      <label className="summary-field">
        <span>{SUMMARY_COPY.answerLabel}</span>
        <textarea rows={6} value={summary.draft} onChange={(event) => { summary.setDraft(event.target.value); }} />
      </label>
      <PasteResult summary={summary} />
      <PillSwitch label={SUMMARY_COPY.friends} isOn={summary.isFriendsOn} isDisabled={isSending} onChange={summary.setFriendsOn} />
      <div className="actions">
        <button type="button" disabled={!canSave} onClick={() => void summary.save()}>{isSending ? SUMMARY_COPY.saving : SUMMARY_COPY.save}</button>
      </div>
    </>
  );
};

// A saved summary: how its check went, who can ask about it, and the ways to replace or delete it.
const SavedSummary = (props: { view: SummaryView; summary: SummaryHook }): ReactElement => {
  return (
    <>
      <p role="status" className="summary-check">{checkLine(props.view)}</p>
      <p className="summary-note">{props.view.friendsCanAsk ? SUMMARY_COPY.friendsOn : SUMMARY_COPY.friendsOff}</p>
      <div className="actions">
        <button type="button" className="quiet" onClick={props.summary.startReplacing}>{SUMMARY_COPY.replace}</button>
        <button type="button" className="quiet" disabled={props.summary.send.kind === "sending"} onClick={() => void props.summary.remove()}>{SUMMARY_COPY.delete}</button>
      </div>
    </>
  );
};

// The section's body: the first read, its error, the form when there is no summary or a new one is being pasted, else the saved one.
function sectionBody(summary: SummaryHook): ReactElement {
  const { view } = summary;
  if (view.value === null && view.isLoading) return <LoadingLine text={SUMMARY_COPY.loading} />;
  if (view.value === null && view.error !== null) return <ErrorNotice error={view.error} />;
  if (view.value === null || summary.isReplacing) return <SummaryForm summary={summary} />;
  return <SavedSummary view={view.value} summary={summary} />;
}

// Your AI's summary of you, on Me and first on the upload page. hasChats is false when you have no chats yet, which adds the line
// that asks for them; null on the upload page, whose next part is adding them.
export const SummarySection = (props: { hasChats: boolean | null; summary: SummaryHook }): ReactElement => {
  const titleId = useId();
  const { send } = props.summary;
  return (
    <section className="summary-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{SUMMARY_COPY.title}</h2>
      {sectionBody(props.summary)}
      {send.kind === "failed" ? <ErrorNotice error={send.error} /> : null}
      {props.hasChats === false ? (
        <p className="summary-nudge">
          {SUMMARY_COPY.nudge} <Link to={APP_PATHS.upload}>{SUMMARY_COPY.addChats}</Link>
        </p>
      ) : null}
    </section>
  );
};
