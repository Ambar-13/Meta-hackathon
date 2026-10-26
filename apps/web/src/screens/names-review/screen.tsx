import type { ReactElement } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { NAMES_PAGE_SIZE, type SourceView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { NamesModeChoice, NamesPager, OptInChoices, RoleGroups } from "./name-rows.js";
import { useNamesReview, type SaveState } from "./names-review-state.js";

// The count line under the title, with the right word for each count.
function countLine(total: number): string {
  if (total === 0) return "No other people's names were found.";
  if (total === 1) return "1 name found.";
  return `${String(total)} names found.`;
}

// The review for a source that is already frozen: the one button to build the card again.
const FrozenBody = (props: { save: SaveState; onBuild: () => void }): ReactElement => {
  return (
    <>
      <p>This source is already reviewed.</p>
      <button type="button" disabled={props.save.kind === "saving"} onClick={props.onBuild}>
        Build my card
      </button>
      {props.save.kind === "card_failed" ? <ErrorNotice error={props.save.error} /> : null}
    </>
  );
};

// The save button and its messages: the hint while the names check runs, and the errors of a failed save.
const SaveBlock = (props: { isStable: boolean; save: SaveState; onSave: () => void; onBuild: () => void }): ReactElement => {
  const { save } = props;
  return (
    <>
      <button type="button" disabled={!props.isStable || save.kind === "saving"} onClick={props.onSave}>
        Save and build my card
      </button>
      {props.isStable ? null : <p className="muted">The button opens when the names check has finished.</p>}
      {save.kind === "saving" ? <p role="status">Saving.</p> : null}
      {save.kind === "review_failed" ? <ErrorNotice error={save.error} /> : null}
      {save.kind === "card_failed" ? (
        <>
          <ErrorNotice error={save.error} />
          <button type="button" onClick={props.onBuild}>
            Build my card
          </button>
        </>
      ) : null}
    </>
  );
};

// The review of a source that is not frozen yet: the names, the choices, the opt-ins and the save.
const ReviewBody = (props: { review: ReturnType<typeof useNamesReview>; view: SourceView }): ReactElement => {
  const { review, view } = props;
  const total = view.names.total;
  return (
    <>
      {review.isStable ? null : <p>{"Looking for other people's names in your messages. This takes about 10 seconds."}</p>}
      <p>{countLine(total)}</p>
      <NamesModeChoice mode={review.mode} onChange={review.setMode} />
      <RoleGroups rows={view.names.rows} mode={review.mode} kept={review.kept} onToggle={review.toggleKeep} />
      {total > NAMES_PAGE_SIZE ? <NamesPager page={review.page} total={total} onPage={review.setPage} /> : null}
      <OptInChoices optIns={review.optIns} onToggle={review.toggleOptIn} />
      <SaveBlock isStable={review.isStable} save={review.save} onSave={() => void review.saveReview()} onBuild={() => void review.requestCard()} />
    </>
  );
};

// The names review: see the names found, keep any you choose, opt in to sensitive kinds, save and build the card (R2.4, D16, D18).
export const NamesReviewScreen = (): ReactElement => {
  const navigate = useNavigate();
  const sourceId = useParams()["sourceId"] ?? "";
  const review = useNamesReview(sourceId, (cardId) => {
    navigate(APP_PATHS.card(cardId));
  });
  const view = review.polled.value;
  if (view === null) {
    return <ScreenFrame title="Check the names">{review.polled.error === null ? <p>Loading the names.</p> : <ErrorNotice error={review.polled.error} />}</ScreenFrame>;
  }
  return (
    <ScreenFrame title="Check the names">
      {view.frozenAt === null ? <ReviewBody review={review} view={view} /> : <FrozenBody save={review.save} onBuild={() => void review.requestCard()} />}
    </ScreenFrame>
  );
};
