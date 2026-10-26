import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { BRIEF_SECTION_LABELS, type Brief } from "@meet-first/contracts";
import { APP_PATHS, ScreenFrame } from "../../app-shell/index.js";
import { BriefSection } from "./brief-sections.js";
import { QuoteSheet } from "./quote-sheet.js";
import { splitBriefForDisplay, useBriefState, type BriefScreenHook, type OpenQuote } from "./brief-state.js";

// The one line under the title: the rate as a rate, or the note that the check did not run (A1).
export function supportLine(brief: Brief): string {
  if (brief.supportReliable !== true || brief.supportRate === null) return "The support check did not run. Every line is marked weak receipt.";
  const lines = [...brief.agree, ...brief.clash, ...brief.decideFirst];
  const withQuote = lines.filter((point) => point.quotes.length > 0);
  const supported = withQuote.filter((point) => point.supported === true).length;
  return `Support rate ${brief.supportRate.toFixed(2)}: ${String(supported)} of ${String(withQuote.length)} lines are backed by their quote.`;
}

// The sections, the quote sheet and the two links of a finished brief.
const BriefBody = (props: { brief: Brief; meetingId: string; hook: BriefScreenHook; sheetQuote: OpenQuote | null }): ReactElement => {
  const sections = splitBriefForDisplay(props.brief);
  // The headings follow the question: "where you'd click" for getting along, "where you agree" for a deal.
  const labels = BRIEF_SECTION_LABELS[props.brief.questionKind];
  return (
    <>
      <p>{supportLine(props.brief)}</p>
      <BriefSection title={labels.agree} points={sections.agree} onQuote={props.hook.showQuote} />
      <BriefSection title={labels.clash} points={sections.clash} onQuote={props.hook.showQuote} />
      <BriefSection title={labels.decideFirst} points={sections.decideFirst} onQuote={props.hook.showQuote} />
      {sections.setAside.length > 0 ? <BriefSection title="Set aside" points={sections.setAside} onQuote={props.hook.showQuote} /> : null}
      <nav aria-label="Next steps">
        <Link to={APP_PATHS.comic(props.meetingId)} style={{ display: "inline-block", minHeight: 44 }}>Draw the comic</Link>{" "}
        <Link to={APP_PATHS.consent(props.meetingId)} style={{ display: "inline-block", minHeight: 44 }}>Share this meeting</Link>
      </nav>
      <QuoteSheet sheet={props.sheetQuote} onClose={props.hook.hideQuote} />
    </>
  );
};

// The brief page: waits while the brief is written, then shows the three sections with tappable quotes (R6.5, A1).
export const BriefScreen = (): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const hook = useBriefState(meetingId);
  return (
    <ScreenFrame title="Your brief">
      {hook.kind === "waiting" ? <p>Writing your brief. This takes about a minute.</p> : null}
      {hook.kind === "gone" ? <p>This meeting is gone.</p> : null}
      {hook.kind === "error" ? <p role="alert">This brief could not be loaded. Reload the page to try again.</p> : null}
      {hook.kind === "ready" ? <BriefBody brief={hook.brief} meetingId={meetingId} hook={hook} sheetQuote={hook.openQuote} /> : null}
    </ScreenFrame>
  );
};
