import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { BRIEF_SECTION_LABELS, type Brief, type Quote } from "@meet-first/contracts";
import { APP_PATHS, ScreenFrame } from "../../app-shell/index.js";
import { Avatar, EmptyState, KIND_LOOK, LoadingLine } from "../../look/index.js";
import { BriefSection } from "./brief-sections.js";
import { QuoteSheet } from "./quote-sheet.js";
import {
  splitBriefForDisplay,
  useBriefState,
  type BriefScreenHook,
  type OpenQuote,
} from "./brief-state.js";
import "./brief.css";

// The one line under the title: the rate as a rate, or the note that the check did not run.
export function supportLine(brief: Brief): string {
  if (brief.supportReliable !== true || brief.supportRate === null)
    return "The support check did not run. Every line is marked weak quote.";
  const lines = [...brief.agree, ...brief.clash, ...brief.decideFirst];
  const withQuote = lines.filter((point) => point.quotes.length > 0);
  const supported = withQuote.filter((point) => point.supported === true).length;
  return `Support rate ${brief.supportRate.toFixed(2)}: ${String(supported)} of ${String(withQuote.length)} lines are backed by their quote.`;
}

// The first quote of the brief that matched its turn, shown large: their own words are the hero of
// the page.
function featuredQuote(brief: Brief): Quote | null {
  for (const point of [...brief.agree, ...brief.decideFirst, ...brief.clash]) {
    const quote = point.quotes.find((candidate) => candidate.verified);
    if (quote !== undefined) return quote;
  }
  return null;
}

// The quote in large type, with the side it came from.
const PullQuote = (props: { quote: Quote | null }): ReactElement | null => {
  if (props.quote === null) return null;
  const side = props.quote.side === "a" ? "A" : "B";
  return (
    <figure className="brief-pull">
      <blockquote>{props.quote.text}</blockquote>
      <figcaption>
        <Avatar name={side} side={props.quote.side} isSmall />
        {`Side ${side}, in their own words`}
      </figcaption>
    </figure>
  );
};

// The sections, the featured quote, the quote sheet and the two next steps of a finished brief.
const BriefBody = (props: {
  brief: Brief;
  meetingId: string;
  hook: BriefScreenHook;
  sheetQuote: OpenQuote | null;
}): ReactElement => {
  const sections = splitBriefForDisplay(props.brief);
  // The headings follow the question: "where you'd click" for getting along, "where you agree" for
  // a deal.
  const labels = BRIEF_SECTION_LABELS[props.brief.questionKind];
  const kind = KIND_LOOK[props.brief.questionKind];
  return (
    <>
      <div className="brief-lead">
        <span className={`pill ${kind.colour}`}>
          <span className="dot" />
          {kind.label}
        </span>
        <p className="brief-support">{supportLine(props.brief)}</p>
      </div>
      <BriefSection
        title={labels.agree}
        points={sections.agree}
        onQuote={props.hook.showQuote}
        tone="agree"
      />
      <BriefSection
        title={labels.clash}
        points={sections.clash}
        onQuote={props.hook.showQuote}
        tone="clash"
      />
      <BriefSection
        title={labels.decideFirst}
        points={sections.decideFirst}
        onQuote={props.hook.showQuote}
        tone="first"
      />
      {sections.setAside.length > 0 ? (
        <BriefSection
          title="Set aside"
          points={sections.setAside}
          onQuote={props.hook.showQuote}
          tone="aside"
        />
      ) : null}
      <PullQuote quote={featuredQuote(props.brief)} />
      <nav className="actions brief-next" aria-label="Next steps">
        <Link className="btn" to={APP_PATHS.comic(props.meetingId)}>
          Draw the comic
        </Link>
        <Link className="btn quiet" to={APP_PATHS.consent(props.meetingId)}>
          Share this meeting
        </Link>
      </nav>
      <QuoteSheet sheet={props.sheetQuote} onClose={props.hook.hideQuote} />
    </>
  );
};

// The brief page: waits while the brief is written, then shows the three sections with tappable
// quotes.
export const BriefScreen = (): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const hook = useBriefState(meetingId);
  return (
    <ScreenFrame title="Your brief">
      {hook.kind === "loading" ? <LoadingLine text="Opening your brief." /> : null}
      {hook.kind === "waiting" ? (
        <LoadingLine text="Writing your brief. This takes about a minute." />
      ) : null}
      {hook.kind === "gone" ? (
        <EmptyState
          sticker="poof"
          title="This meeting is gone."
          action={
            <Link className="btn" to={APP_PATHS.home}>
              Go home
            </Link>
          }
        />
      ) : null}
      {hook.kind === "error" ? (
        <p role="alert" className="notice">
          This brief could not be loaded. Reload the page to try again.
        </p>
      ) : null}
      {hook.kind === "ready" ? (
        <BriefBody
          brief={hook.brief}
          meetingId={meetingId}
          hook={hook}
          sheetQuote={hook.openQuote}
        />
      ) : null}
    </ScreenFrame>
  );
};
