import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { CURATED_QUESTIONS, type MeetingView, type PairMeetingRow } from "@meet-first/contracts";
import { ApiError, ErrorNotice, meetingPathWithSide, readViewerSide } from "../../app-shell/index.js";
import { MEETING_STATE_LABELS, type QuestionPick } from "./lobby-state.js";

// The label of the free-text box in the picker.
const FREE_TEXT_LABEL = "Your question (5 to 300 characters)";
// The longest free-text question the picker accepts (R10.5).
const FREE_TEXT_MAX_CHARS = 300;

// The 12 curated questions and a free-text choice (R10.5).
export const QuestionPicker = (props: { isSending: boolean; error: string | null; onCreate: (pick: QuestionPick) => void }): ReactElement => {
  const [choice, setChoice] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (choice === null) return;
    if (choice === "free") props.onCreate({ kind: "free", text: freeText });
    else props.onCreate({ kind: "curated", questionId: Number(choice) });
  };
  return (
    <form onSubmit={onSubmit}>
      <fieldset>
        <legend>Pick a question for the meeting</legend>
        {CURATED_QUESTIONS.map((question) => (
          <label className="inline" key={question.id}>
            <input type="radio" name="question" value={String(question.id)} checked={choice === String(question.id)} onChange={() => { setChoice(String(question.id)); }} />
            {question.text}
          </label>
        ))}
        <label className="inline">
          <input type="radio" name="question" value="free" checked={choice === "free"} onChange={() => { setChoice("free"); }} />
          Write your own question
        </label>
        {choice === "free" ? (
          <label>
            {FREE_TEXT_LABEL}
            <textarea maxLength={FREE_TEXT_MAX_CHARS} value={freeText} onChange={(event) => { setFreeText(event.target.value); }} />
          </label>
        ) : null}
        <button type="submit" disabled={choice === null || props.isSending}>
          Create the meeting
        </button>
      </fieldset>
      {props.error === null ? null : <p role="alert">{props.error}</p>}
    </form>
  );
};

// The state words of one meeting row, with the queue position when there is one.
function meetingStateLine(meeting: PairMeetingRow): string {
  if (meeting.state === "queued" && meeting.queuePosition !== undefined) return `In the queue, position ${String(meeting.queuePosition)}`;
  return MEETING_STATE_LABELS[meeting.state];
}

// The pair's meetings with their states and, once running, a link in.
export const MeetingList = (props: { meetings: PairMeetingRow[] }): ReactElement => {
  return (
    <section>
      <h2>Meetings</h2>
      <ul>
        {props.meetings.map((meeting) => (
          <li key={meeting.id}>
            <p>{meeting.questionText}</p>
            <p className="muted">{meetingStateLine(meeting)}</p>
            {meeting.state === "running" || meeting.state === "ended" ? <Link to={meetingPathWithSide(meeting.id, readViewerSide(meeting.id))}>Open the meeting</Link> : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

// One line per member: the name, whether they said ready, and whether they are watching now.
const MemberLines = (props: { meeting: MeetingView }): ReactElement => {
  return (
    <>
      {props.meeting.members.map((member) => (
        <p key={member.side}>{`${member.displayName}: ${member.ready ? "ready" : "not ready yet"}, ${member.connected ? "watching now" : "not watching now"}`}</p>
      ))}
    </>
  );
};

// The line under the members while the meeting waits: both ready, or the other person still to say ready.
const ReadyNote = (props: { meeting: MeetingView }): ReactElement | null => {
  const isBothReady = props.meeting.members.every((member) => member.ready);
  if (props.meeting.state !== "ready") return null;
  if (isBothReady) return <p>Both of you have said ready. The meeting starts by itself.</p>;
  return <p>Waiting for the other person to say ready.</p>;
};

// The next meeting: its question, both members' ready and watching marks, and the ready button (D53, R10.5).
export const StartPanel = (props: { meeting: MeetingView; isBusy: boolean; error: ApiError | null; onReady: () => void }): ReactElement => {
  const { meeting } = props;
  const viewer = meeting.members.find((member) => member.side === meeting.viewerSide);
  const isViewerWaiting = viewer !== undefined && !viewer.ready && meeting.state === "ready";
  return (
    <section className="panel">
      <h2>The next meeting</h2>
      <p>{`Question: ${meeting.questionText}`}</p>
      {meeting.questionChecked ? null : <p className="muted">Checking the question.</p>}
      <MemberLines meeting={meeting} />
      {meeting.state === "queued" && meeting.queuePosition !== undefined ? <p>{`All rooms are busy. You are number ${String(meeting.queuePosition)} in the queue.`}</p> : null}
      <ReadyNote meeting={meeting} />
      {isViewerWaiting ? (
        <button type="button" disabled={props.isBusy} onClick={props.onReady}>
          I'm ready
        </button>
      ) : null}
      {props.error === null ? null : <ErrorNotice error={props.error} />}
    </section>
  );
};
