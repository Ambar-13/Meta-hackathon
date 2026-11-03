import "./share.css";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { APP_PATHS, ScreenFrame } from "../../app-shell/index.js";
import { Cloud, EmptyState, LoadingLine } from "../../look/index.js";
import { SnapshotTags, SnapshotView } from "./snapshot-view.js";
import { usePublicSnapshot } from "./share-state.js";

// Where the "Report this page" link goes: an email to Meety, with the subject filled in.
export const REPORT_LINK_HREF = "mailto:hey.meety@gmail.com?subject=Report%20a%20shared%20page";
// The words shown when no page is there, for an unknown, unpublished or taken-down slug.
const NOT_FOUND_TEXT = "No page here. It may have been taken down.";
// The heading of the public page while it has no question to show.
const PAGE_TITLE = "Shared meeting";
// The words of the page.
const PUBLIC_COPY = {
  loading: "Opening the shared meeting.",
  notFoundTitle: "Nothing to read here",
  whatIs: "What is Meety?",
} as const;

// The public share page: the two name tags over the sky, the question as the heading, then the snapshot, then the report link.
// Visitors need no session.
export const PublicSharePage = (): ReactElement => {
  const slug = useParams()["slug"] ?? "";
  const state = usePublicSnapshot(slug);
  if (state.kind === "ready") {
    return (
      <ScreenFrame title={state.snapshot.question} hideSettingsLink isWide>
        <div className="sky share-sky" aria-hidden="true">
          <Cloud className="share-cloud-1" />
          <Cloud className="share-cloud-2" />
          <span className="scallop" />
        </div>
        <SnapshotTags snapshot={state.snapshot} />
        <div className="share-page">
          <SnapshotView snapshot={state.snapshot} />
          <p className="share-report">
            <a href={REPORT_LINK_HREF}>Report this page</a>
          </p>
        </div>
      </ScreenFrame>
    );
  }
  if (state.kind === "not_found") {
    return (
      <ScreenFrame title={PAGE_TITLE} hideSettingsLink>
        <EmptyState sticker="poof" title={PUBLIC_COPY.notFoundTitle} action={<Link className="btn quiet" to={APP_PATHS.welcome}>{PUBLIC_COPY.whatIs}</Link>}>
          {NOT_FOUND_TEXT}
        </EmptyState>
      </ScreenFrame>
    );
  }
  if (state.kind === "error") {
    return (
      <ScreenFrame title={PAGE_TITLE} hideSettingsLink>
        <div className="notice" role="alert">
          <p>{state.message}</p>
        </div>
      </ScreenFrame>
    );
  }
  return (
    <ScreenFrame title={PAGE_TITLE} hideSettingsLink>
      <LoadingLine text={PUBLIC_COPY.loading} />
    </ScreenFrame>
  );
};
