import "./comic.css";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, LoadingLine } from "../../look/index.js";
import { AvatarPicker } from "./avatar-picker.js";
import {
  BRIEF_NOT_READY_COPY,
  RENDERING_COPY,
  SKIP_COPY,
  SKIP_COPY_OTHER,
  useComicState,
  type ComicHook,
  type ComicSkipReason,
} from "./comic-state.js";
import { DrawingFrames, PanelGrid } from "./panel-grid.js";

// The sentence that says what the comic is, above the picker (comic spec 4.8).
export const COMIC_INTRO_COPY =
  "Six panels drawn from the lines the support check backed. Two cartoon characters stand in for you both; no faces, no names.";

// The one sentence for a skipped comic, from the reason when the view carries one; no retry is
// offered (one comic per meeting).
export const SkippedNotice = (props: { reason: ComicSkipReason | null }): ReactElement => {
  return (
    <EmptyState sticker="poof" title="No comic for this meeting">
      {props.reason === null ? SKIP_COPY_OTHER : SKIP_COPY[props.reason]}
    </EmptyState>
  );
};

// The link back to the brief, the way on once the comic is done or not drawn.
const BackToBrief = (props: { meetingId: string }): ReactElement => {
  return (
    <div className="actions comic-after">
      <Link className="btn" to={APP_PATHS.brief(props.meetingId)}>
        Back to the brief
      </Link>
    </div>
  );
};

// The body of the comic page for one state.
const ComicBody = (props: { comic: ComicHook; meetingId: string }): ReactElement => {
  const { comic } = props;
  if (comic.kind === "loading") return <LoadingLine text="Loading your comic." />;
  if (comic.kind === "error") return <ErrorNotice error={comic.error} />;
  if (comic.kind === "pick") {
    return (
      <>
        <p className="comic-intro">{COMIC_INTRO_COPY}</p>
        <AvatarPicker
          selected={comic.avatar}
          isSending={comic.isSending}
          onPick={comic.pick}
          onDraw={() => void comic.request()}
        />
        {comic.isSending ? <LoadingLine text="Asking for your comic." /> : null}
        {comic.requestError === null ? null : <ErrorNotice error={comic.requestError} />}
      </>
    );
  }
  if (comic.kind === "rendering") {
    return (
      <>
        <LoadingLine text={RENDERING_COPY} />
        <DrawingFrames />
      </>
    );
  }
  if (comic.kind === "ready") {
    return (
      <>
        <BackToBrief meetingId={props.meetingId} />
        <PanelGrid panels={comic.panels} />
      </>
    );
  }
  if (comic.kind === "brief_not_ready") {
    return (
      <EmptyState
        sticker="cup"
        title="Waiting for the brief"
        action={
          <Link className="btn" to={APP_PATHS.brief(props.meetingId)}>
            Back to the brief
          </Link>
        }
      >
        {BRIEF_NOT_READY_COPY}
      </EmptyState>
    );
  }
  return (
    <>
      <SkippedNotice reason={comic.reason} />
      <BackToBrief meetingId={props.meetingId} />
    </>
  );
};

// The comic page: pick a character, ask for the comic, watch it draw, then see the six panels.
export const ComicScreen = (): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const comic = useComicState(meetingId);
  return (
    <ScreenFrame title="The comic">
      <ComicBody comic={comic} meetingId={meetingId} />
    </ScreenFrame>
  );
};
