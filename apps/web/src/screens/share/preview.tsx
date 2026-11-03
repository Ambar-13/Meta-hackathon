import type { ReactElement } from "react";
import { BRIEF_SECTION_LABELS, type BriefPoint, type MeetingView } from "@meet-first/contracts";
import { ErrorNotice } from "../../app-shell/index.js";
import { EmptyState, LoadingLine, NameTag, Receipt } from "../../look/index.js";
import { PREVIEW_SECTIONS, type PreviewLines, type PublishPreview } from "./share-state.js";

// The words of the preview that no input gives [confirm] (drafted copy, design fix 2 of the brief).
export const PREVIEW_COPY = {
  heading: "What the page will show",
  loading: "Reading what the page would hold.",
  noLinesTitle: "No brief lines to publish",
  noLines: "None of your brief lines passed the support check, so the page shows none of them.",
  alsoShown: "The card items you both approved, what the two agents said, and the other person's checked brief lines will appear too.",
} as const;

// The display name of one side of the meeting, or an empty string when the view does not hold it.
function nameOf(meeting: MeetingView, side: "a" | "b"): string {
  return meeting.members.find((member) => member.side === side)?.displayName ?? "";
}

// One line that would be published, with each of its quotes and whose side the quote came from.
const PreviewLine = (props: { point: BriefPoint; meeting: MeetingView }): ReactElement => {
  return (
    <li>
      <p>{props.point.text}</p>
      <div className="share-receipts">
        {props.point.quotes.map((quote, index) => (
          <Receipt key={`${String(index)}-${quote.turnId}`} quote={quote.text} source={`From ${nameOf(props.meeting, quote.side)}'s side`} />
        ))}
      </div>
    </li>
  );
};

// The brief lines that would be published, by section, or the empty state when none passed, or the error when the brief failed.
const PreviewBrief = (props: { lines: PreviewLines; meeting: MeetingView }): ReactElement => {
  if (props.lines.kind === "failed") return <ErrorNotice error={props.lines.error} />;
  const { sections } = props.lines;
  const hasAny = PREVIEW_SECTIONS.some((section) => sections[section].length > 0);
  if (!hasAny) {
    return (
      <EmptyState sticker="nope" title={PREVIEW_COPY.noLinesTitle}>
        {PREVIEW_COPY.noLines}
      </EmptyState>
    );
  }
  const labels = BRIEF_SECTION_LABELS[props.meeting.questionKind];
  return (
    <>
      {PREVIEW_SECTIONS.filter((section) => sections[section].length > 0).map((section) => (
        <div key={section} className="share-preview-section">
          <h3>{labels[section]}</h3>
          <ul className="share-lines">
            {sections[section].map((point, index) => (
              <PreviewLine key={`${section}-${String(index)}`} point={point} meeting={props.meeting} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
};

// The preview above the consent button: the two names and the question as the page heads them, then the brief lines that passed
// the support check with their quotes, then one line for what the routes here cannot read (design fix 2 of the brief).
export const PublishPreviewPanel = (props: { preview: PublishPreview }): ReactElement | null => {
  const { preview } = props;
  if (preview.kind === "none") return null;
  if (preview.kind === "loading") return <LoadingLine text={PREVIEW_COPY.loading} />;
  const { meeting } = preview;
  const nameA = nameOf(meeting, "a");
  const nameB = nameOf(meeting, "b");
  return (
    <section className="share-preview" aria-labelledby="share-preview-title">
      <h2 id="share-preview-title">{PREVIEW_COPY.heading}</h2>
      <div className="share-preview-page">
        <div className="sky share-preview-top">
          <div className="share-duel" aria-hidden="true">
            <NameTag name={nameA} colour="coral" className="share-tag-a" />
            <span className="share-and">&amp;</span>
            <NameTag name={nameB} colour="blue" className="share-tag-b" />
          </div>
          <p className="share-preview-names">{`${nameA} and ${nameB}`}</p>
          <p className="share-preview-question">{meeting.questionText}</p>
          <span className="scallop" />
        </div>
        <div className="share-preview-body">
          {preview.lines === null ? null : <PreviewBrief lines={preview.lines} meeting={meeting} />}
          <p className="share-also">{PREVIEW_COPY.alsoShown}</p>
        </div>
      </div>
    </section>
  );
};
