import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import { ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { AvatarPicker } from "./avatar-picker.js";
import { BRIEF_NOT_READY_COPY, RENDERING_COPY, SKIP_COPY, SKIP_COPY_OTHER, useComicState, type ComicSkipReason } from "./comic-state.js";
import { PanelGrid } from "./panel-grid.js";

// The sentence that says what the comic is, above the picker (comic spec 4.8).
export const COMIC_INTRO_COPY = "Six panels drawn from the lines the support check backed. Two cartoon characters stand in for you both; no faces, no names.";

// The one sentence for a skipped comic, from the reason when the view carries one; no retry is offered (one comic per meeting).
export const SkippedNotice = (props: { reason: ComicSkipReason | null }): ReactElement => {
  return <p>{props.reason === null ? SKIP_COPY_OTHER : SKIP_COPY[props.reason]}</p>;
};

// The comic page: pick a character, ask for the comic, watch it draw, then see the six panels (R11.2, R11.3).
export const ComicScreen = (): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const comic = useComicState(meetingId);
  if (comic.kind === "loading") return <ScreenFrame title="The comic"><p>Loading your comic.</p></ScreenFrame>;
  if (comic.kind === "error") return <ScreenFrame title="The comic"><ErrorNotice error={comic.error} /></ScreenFrame>;
  if (comic.kind === "pick") {
    return (
      <ScreenFrame title="The comic">
        <p>{COMIC_INTRO_COPY}</p>
        <AvatarPicker selected={comic.avatar} isSending={comic.isSending} onPick={comic.pick} onDraw={() => void comic.request()} />
        {comic.requestError === null ? null : <ErrorNotice error={comic.requestError} />}
      </ScreenFrame>
    );
  }
  if (comic.kind === "rendering") return <ScreenFrame title="The comic"><p>{RENDERING_COPY}</p></ScreenFrame>;
  if (comic.kind === "ready") return <ScreenFrame title="The comic"><PanelGrid panels={comic.panels} /></ScreenFrame>;
  if (comic.kind === "brief_not_ready") return <ScreenFrame title="The comic"><p>{BRIEF_NOT_READY_COPY}</p></ScreenFrame>;
  return <ScreenFrame title="The comic"><SkippedNotice reason={comic.reason} /></ScreenFrame>;
};
