import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import type { MeetingView, Phase } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, type ApiError } from "../../app-shell/index.js";
import { LoadingLine, NameTag, Sticker } from "../../look/index.js";
import { openMeetingFeed, type FeedStatus, type MeetingFeed, type MeetingFeedOptions } from "../../streaming/index.js";
import { isThinking, refreshNotice, type MeetingFoldState } from "../../transcript/index.js";
import { PHASE_LABELS, TranscriptView, speakerName } from "./transcript-view.js";
import { POLLING_COPY, RECONNECTING_COPY, useMeetingScreen, useSecondTick } from "./meeting-state.js";
import "./meeting.css";

// The line under "The meeting has ended." for each end reason [confirm] (drafted copy, no input gives it).
export const ENDED_LINES: Record<"decided" | "budget" | "deleted", string> = {
  decided: "Both personas reached the decide step.",
  budget: "The meeting stopped at its token budget.",
  deleted: "This meeting was deleted.",
};

// The words for the feed status: polling and reconnecting have a line, the others have none.
const STATUS_COPY: Partial<Record<FeedStatus, string>> = { polling: POLLING_COPY, reconnecting: RECONNECTING_COPY };
// The four parts of a meeting, in order, as the stage shows them.
const PHASES: readonly Phase[] = ["open", "explore", "decide", "close"];

// The line for a meeting that has not started yet, or is gone.
const WaitingLine = (props: { view: MeetingView }): ReactElement | null => {
  if (props.view.state === "deleted") return <p className="meeting-note">This meeting is gone.</p>;
  if (props.view.state === "ready" || props.view.state === "queued") {
    const queue = props.view.queuePosition === undefined ? "" : ` In the queue, position ${String(props.view.queuePosition)}.`;
    return <LoadingLine text={`Waiting for the meeting to start.${queue}`} />;
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
      {statusCopy === undefined ? null : <p className="muted meeting-status" role="status">{statusCopy}</p>}
    </>
  );
};

// The card at the foot of the screen: watching live while it runs, then the reason it ended and the way to the brief.
const MeetingDock = (props: { meetingId: string; fold: MeetingFoldState }): ReactElement | null => {
  const { ended } = props.fold;
  if (ended === null) {
    if (props.fold.started === null) return null;
    return (
      <div className="meeting-dock">
        <p>Watching live. The brief opens when they finish.</p>
      </div>
    );
  }
  return (
    <section className="meeting-dock ended" aria-labelledby="meeting-ended-title">
      <h2 id="meeting-ended-title">The meeting has ended.</h2>
      <p>{ENDED_LINES[ended.reason]}</p>
      {props.fold.isBriefReady ? (
        <div className="actions">
          <Link className="btn" to={APP_PATHS.brief(props.meetingId)}>Read your brief</Link>
          <Link className="btn quiet" to={APP_PATHS.comic(props.meetingId)}>Draw the comic</Link>
          <Link className="btn quiet" to={APP_PATHS.consent(props.meetingId)}>Share this meeting</Link>
        </div>
      ) : (
        <p className="meeting-writing">Writing your brief.</p>
      )}
    </section>
  );
};

// The two people of the meeting, from the started event or else the meeting view, side a first.
function sideNames(fold: MeetingFoldState, view: MeetingView | null): { a: string; b: string } {
  const fromView = (side: "a" | "b"): string | undefined => view?.members.find((member) => member.side === side)?.displayName;
  const nameOf = (side: "a" | "b"): string => (fold.started === null ? (fromView(side) ?? side.toUpperCase()) : speakerName(fold, side));
  return { a: nameOf("a"), b: nameOf("b") };
}

// The class of one phase chip: on for the current part, done for the parts before it, none for the parts still to come.
function phaseClass(index: number, current: number): string {
  if (index === current) return "on";
  return index < current ? "done" : "";
}

// The four parts of the talk as chips, the current one filled; the words for the screen reader come from PHASE_LABELS.
const PhaseChips = (props: { phase: Phase | null }): ReactElement | null => {
  if (props.phase === null) return null;
  const current = PHASES.indexOf(props.phase);
  return (
    <ol className="meeting-phases" aria-label={`Phase: ${PHASE_LABELS[props.phase]}`}>
      {PHASES.map((phase, index) => (
        <li key={phase} className={phaseClass(index, current)} aria-current={index === current ? "step" : undefined}>
          {PHASE_LABELS[phase]}
        </li>
      ))}
    </ol>
  );
};

// The sky at the top: the way home, whether it is live, the two name tags, the question, and which part of the talk this is.
const MeetingStage = (props: { fold: MeetingFoldState; view: MeetingView | null }): ReactElement => {
  const names = sideNames(props.fold, props.view);
  const hasNames = props.fold.started !== null || props.view !== null;
  const isLive = props.fold.started !== null && props.fold.ended === null;
  return (
    <header className="meeting-stage sky">
      <div className="meeting-top">
        <Link className="meeting-back" to={APP_PATHS.home}>Home</Link>
        {isLive ? <span className="pill"><span className="dot" />Live</span> : null}
      </div>
      {hasNames ? (
        <div className="meeting-duel" aria-hidden="true">
          <NameTag name={names.a} className="meeting-tag a" />
          <span className="meeting-and">&amp;</span>
          <NameTag name={names.b} colour="blue" className="meeting-tag b" />
        </div>
      ) : null}
      <h1>{props.fold.started?.question ?? props.view?.questionText ?? "Meeting"}</h1>
      <PhaseChips phase={props.fold.phase} />
      <div className="scallop" aria-hidden="true" />
    </header>
  );
};

// The sticky note a laptop shows beside the talk: how to read the colours, the quotes and the flags.
const ReadingNote = (props: { names: { a: string; b: string } }): ReactElement => {
  return (
    <aside className="sticky-note meeting-legend" aria-label="How to read it">
      <h2>How to read it</h2>
      <ul>
        <li>{`Coral is ${props.names.a}'s persona. Blue is ${props.names.b}'s.`}</li>
        <li>Each quote under a line is from that person&apos;s own words.</li>
        <li><Sticker name="nope" /> No receipt means the persona is guessing.</li>
      </ul>
    </aside>
  );
};

// The meeting page: the sky stage, the streamed transcript in two voices, and the way to the brief (D49, D51, R5.11).
export const MeetingScreen = (props: { openFeed?: (options: MeetingFeedOptions) => MeetingFeed }): ReactElement => {
  const meetingId = useParams()["meetingId"] ?? "";
  const model = useMeetingScreen(meetingId, props.openFeed ?? openMeetingFeed);
  const nowMs = useSecondTick();
  const { view, fold, status, lastActivityMs, stopped } = model;
  const viewValue = view.value;
  return (
    <main className="meeting-layout">
      <MeetingStage fold={fold} view={viewValue} />
      <div className="meeting-body">
        <ReadingNote names={sideNames(fold, viewValue)} />
        <div className="meeting-main">
          <Notices fold={fold} status={status} stopped={stopped} viewError={viewValue === null ? view.error : null} />
          {viewValue === null ? null : <WaitingLine view={viewValue} />}
          <TranscriptView fold={fold} isThinkingNow={isThinking(fold, lastActivityMs, nowMs)} />
          <MeetingDock meetingId={meetingId} fold={fold} />
        </div>
      </div>
    </main>
  );
};
