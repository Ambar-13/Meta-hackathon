import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import type { MeetingView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, type ApiError } from "../../app-shell/index.js";
import { openMeetingFeed, type FeedStatus, type MeetingFeed, type MeetingFeedOptions } from "../../streaming/index.js";
import { isThinking, refreshNotice, type MeetingFoldState } from "../../transcript/index.js";
import { PHASE_LABELS, TranscriptView } from "./transcript-view.js";
import { POLLING_COPY, RECONNECTING_COPY, useMeetingScreen, useSecondTick } from "./meeting-state.js";

// The line under "The meeting has ended." for each end reason [confirm] (drafted copy, no input gives it).
export const ENDED_LINES: Record<"decided" | "budget" | "deleted", string> = {
  decided: "Both personas reached the decide step.",
  budget: "The meeting stopped at its token budget.",
  deleted: "This meeting was deleted.",
};

// The words for the feed status: polling and reconnecting have a line, the others have none.
const STATUS_COPY: Partial<Record<FeedStatus, string>> = { polling: POLLING_COPY, reconnecting: RECONNECTING_COPY };

// The line for a meeting that has not started yet, or is gone.
const WaitingLine = (props: { view: MeetingView }): ReactElement | null => {
  if (props.view.state === "deleted") return <p>This meeting is gone.</p>;
  if (props.view.state === "ready" || props.view.state === "queued") {
    const queue = props.view.queuePosition === undefined ? "" : ` In the queue, position ${String(props.view.queuePosition)}.`;
    return <p>{`Waiting for the meeting to start.${queue}`}</p>;
  }
  return null;
};

// The refresh line for a newer event version, and the screen's error and status lines (R5.11, R8.2, R8.4).
const Notices = (props: { fold: MeetingFoldState; status: FeedStatus; stopped: ApiError | null; viewError: ApiError | null }): ReactElement => {
  const refresh = refreshNotice(props.fold);
  const statusCopy = STATUS_COPY[props.status];
  return (
    <>
      {refresh === null ? null : (
        <div className="notice" role="alert">
          <p>{refresh}</p>
          <button type="button" onClick={() => { window.location.reload(); }}>
            Reload
          </button>
        </div>
      )}
      {props.stopped === null ? null : <ErrorNotice error={props.stopped} />}
      {props.viewError === null ? null : <ErrorNotice error={props.viewError} />}
      {statusCopy === undefined ? null : <p className="muted" role="status">{statusCopy}</p>}
    </>
  );
};

// The panel after the meeting ends: the reason, and the links to the brief once it is written.
const EndedPanel = (props: { meetingId: string; fold: MeetingFoldState }): ReactElement | null => {
  const { ended } = props.fold;
  if (ended === null) return null;
  return (
    <section className="panel">
      <h2>The meeting has ended.</h2>
      <p>{ENDED_LINES[ended.reason]}</p>
      {props.fold.isBriefReady ? (
        <div className="actions">
          <Link to={APP_PATHS.brief(props.meetingId)}>Read your brief</Link>
          <Link to={APP_PATHS.comic(props.meetingId)}>Draw the comic</Link>
          <Link to={APP_PATHS.consent(props.meetingId)}>Share this meeting</Link>
        </div>
      ) : (
        <p>Writing your brief.</p>
      )}
    </section>
  );
};

// The meeting page: the streamed meeting, the transcript and the way to the brief (D49, D51, R5.11).
export const MeetingScreen = (props: { openFeed?: (options: MeetingFeedOptions) => MeetingFeed }): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const model = useMeetingScreen(meetingId, props.openFeed ?? openMeetingFeed);
  const nowMs = useSecondTick();
  const { view, fold, status, lastActivityMs, stopped } = model;
  const viewValue = view.value;
  return (
    <main className="screen meeting-layout">
      <h1>{fold.started?.question ?? viewValue?.questionText ?? "Meeting"}</h1>
      {fold.phase === null ? null : <p className="muted">{`Phase: ${PHASE_LABELS[fold.phase]}`}</p>}
      <Notices fold={fold} status={status} stopped={stopped} viewError={viewValue === null ? view.error : null} />
      {viewValue === null ? null : <WaitingLine view={viewValue} />}
      <TranscriptView fold={fold} isThinkingNow={isThinking(fold, lastActivityMs, nowMs)} />
      <EndedPanel meetingId={meetingId} fold={fold} />
    </main>
  );
};
