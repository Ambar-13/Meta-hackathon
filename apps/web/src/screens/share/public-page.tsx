import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import { ScreenFrame } from "../../app-shell/index.js";
import { SnapshotView } from "./snapshot-view.js";
import { usePublicSnapshot } from "./share-state.js";

// Where the "Report this page" link goes. The report destination is not chosen yet; Ambar fills it in before merge (request 006).
export const REPORT_LINK_HREF = "{GAP: the report destination Ambar chooses; the inputs name a report link and no address, and no personal email goes in the repo}";
// The words shown when no page is there, for an unknown, unpublished or taken-down slug (4.7).
const NOT_FOUND_TEXT = "No page here. It may have been taken down.";
// The heading of the public page while it has no question to show.
const PAGE_TITLE = "Shared meeting";

// The public share page: the question as the heading, then the snapshot, then the report link. Visitors need no session.
export const PublicSharePage = (): ReactElement => {
  const slug = useParams()["slug"] ?? "";
  const state = usePublicSnapshot(slug);
  if (state.kind === "ready") {
    return (
      <ScreenFrame title={state.snapshot.question} hideSettingsLink>
        <SnapshotView snapshot={state.snapshot} />
        <p>
          <a href={REPORT_LINK_HREF}>Report this page</a>
        </p>
      </ScreenFrame>
    );
  }
  if (state.kind === "not_found") {
    return (
      <ScreenFrame title={PAGE_TITLE} hideSettingsLink>
        <p>{NOT_FOUND_TEXT}</p>
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
  return <ScreenFrame title={PAGE_TITLE} hideSettingsLink>{null}</ScreenFrame>;
};
