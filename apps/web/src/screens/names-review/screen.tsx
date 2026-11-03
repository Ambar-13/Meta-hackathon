import "./names-review.css";
import { useEffect, useState, type ReactElement } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { NAMES_PAGE_SIZE, type SourceView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame, type ApiError } from "../../app-shell/index.js";
import { EmptyState, LoadingLine } from "../../look/index.js";
import { NamesModeChoice, NamesPager, OptInChoices, RoleGroups } from "./name-rows.js";
import { useNamesReview, type SaveState } from "./names-review-state.js";

// The line the screen shows while the names check is still running, before and after the first names arrive.
const LOOKING_WORDS = "Looking for names in your notes.";

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
      <EmptyState
        sticker="check"
        title="Names already checked"
        action={
          <button type="button" disabled={props.save.kind === "saving"} onClick={props.onBuild}>
            Build my card
          </button>
        }
      >
        This source is already reviewed.
      </EmptyState>
      {props.save.kind === "card_failed" ? <ErrorNotice error={props.save.error} /> : null}
    </>
  );
};

// The save button and its messages: the hint while the names check runs, and the errors of a failed save. On a phone it is a dock.
const SaveBlock = (props: { isStable: boolean; save: SaveState; onSave: () => void; onBuild: () => void }): ReactElement => {
  const { save } = props;
  return (
    <div className="nr-save">
      {save.kind === "review_failed" ? <ErrorNotice error={save.error} /> : null}
      {save.kind === "card_failed" ? <ErrorNotice error={save.error} /> : null}
      <div className="nr-save-row">
        {props.isStable ? null : <p className="muted nr-save-note">The button opens when the names check has finished.</p>}
        {save.kind === "saving" ? <LoadingLine text="Saving." /> : null}
        <button type="button" disabled={!props.isStable || save.kind === "saving"} onClick={props.onSave}>
          Save and build my card
        </button>
        {save.kind === "card_failed" ? (
          <button type="button" className="quiet" onClick={props.onBuild}>
            Build my card
          </button>
        ) : null}
      </div>
    </div>
  );
};

// The review of a source that is not frozen yet: the names, the choices, the opt-ins and the save.
const ReviewBody = (props: { review: ReturnType<typeof useNamesReview>; view: SourceView }): ReactElement => {
  const { review, view } = props;
  const total = view.names.total;
  return (
    <div className="nr-body">
      <div className="nr-top">
        {review.isStable ? null : <LoadingLine text={LOOKING_WORDS} />}
        {total === 0 ? null : <p className="nr-count">{countLine(total)}</p>}
      </div>
      <div className="nr-main">
        {total === 0 ? (
          <EmptyState sticker="smile" title="No names to hide">
            {countLine(total)}
          </EmptyState>
        ) : (
          <>
            <RoleGroups rows={view.names.rows} mode={review.mode} kept={review.kept} onToggle={review.toggleKeep} />
            {total > NAMES_PAGE_SIZE ? <NamesPager page={review.page} total={total} onPage={review.setPage} /> : null}
          </>
        )}
      </div>
      <aside className="nr-side">
        {total === 0 ? null : (
          <div className="nr-side-mode">
            <NamesModeChoice mode={review.mode} onChange={review.setMode} />
          </div>
        )}
        <div className="nr-side-optins">
          <OptInChoices optIns={review.optIns} onToggle={review.toggleOptIn} />
        </div>
        <SaveBlock isStable={review.isStable} save={review.save} onSave={() => void review.saveReview()} onBuild={() => void review.requestCard()} />
      </aside>
    </div>
  );
};

// The first load failed: the error in one sentence, and a button that asks for the names again (the poll's own reload).
const FailedBody = (props: { error: ApiError; isLoading: boolean; onRetry: () => void }): ReactElement => {
  const [isRetrying, setIsRetrying] = useState(false);
  useEffect(() => {
    if (!props.isLoading) setIsRetrying(false);
  }, [props.isLoading]);
  const retry = (): void => {
    setIsRetrying(true);
    props.onRetry();
  };
  return (
    <section className="nr-failed">
      <ErrorNotice error={props.error} />
      <div className="actions">
        <button type="button" disabled={isRetrying} onClick={retry}>
          Try again
        </button>
      </div>
      {isRetrying ? <LoadingLine text="Trying again." /> : null}
    </section>
  );
};

// The names review: see the names found, keep any you choose, opt in to sensitive kinds, save and build the card.
// Three states before the review: looking (first load out), failed (first load refused, with a retry that polls again), found.
export const NamesReviewScreen = (): ReactElement => {
  const navigate = useNavigate();
  const sourceId = useParams()["sourceId"] ?? "";
  const review = useNamesReview(sourceId, (cardId) => {
    navigate(APP_PATHS.card(cardId));
  });
  const view = review.polled.value;
  if (view === null) {
    const error = review.polled.error;
    return (
      <ScreenFrame title="Check the names">
        {error === null ? (
          <section className="nr-looking">
            <LoadingLine text={LOOKING_WORDS} />
          </section>
        ) : (
          <FailedBody error={error} isLoading={review.polled.isLoading} onRetry={review.polled.reload} />
        )}
      </ScreenFrame>
    );
  }
  const isFrozen = view.frozenAt !== null;
  return (
    <ScreenFrame title="Check the names" isWide={!isFrozen}>
      {isFrozen ? <FrozenBody save={review.save} onBuild={() => void review.requestCard()} /> : <ReviewBody review={review} view={view} />}
    </ScreenFrame>
  );
};
