import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { CURATED_QUESTIONS, type MeetingView, type PairMeetingRow, type QuestionKind } from "@meet-first/contracts";
import { ApiError, ErrorNotice, meetingPathWithSide, readViewerSide } from "../../app-shell/index.js";
import { Avatar, LoadingLine, Sticker } from "../../look/index.js";
import { MEETING_STATE_LABELS, type QuestionPick } from "./lobby-state.js";

// The label of the free-text box in the picker.
const FREE_TEXT_LABEL = "Your question (5 to 300 characters)";
// The longest free-text question the picker accepts (R10.5).
const FREE_TEXT_MAX_CHARS = 300;

// The five groups the picker shows the 20 curated questions in, by kind, each with its colour class; the decision sits with the deals
// and the two situations with the debates.
const QUESTION_GROUPS: ReadonlyArray<{ title: string; kinds: readonly QuestionKind[]; colour: string }> = [
  { title: "Would you get along?", kinds: ["get_along"], colour: "c-green" },
  { title: "Could you help each other?", kinds: ["help"], colour: "c-yellow" },
  { title: "Would you make a deal?", kinds: ["deal", "decision"], colour: "c-coral" },
  { title: "Where would your views split?", kinds: ["debate", "situation"], colour: "c-lilac" },
  { title: "Would you get on as a couple?", kinds: ["romance"], colour: "c-blue" },
];

// The colour class of a question kind, from the group it sits in.
export function kindColour(kind: QuestionKind): string {
  return QUESTION_GROUPS.find((group) => group.kinds.includes(kind))?.colour ?? "c-blue";
}

// One radio row of the picker: the dot, the radio and its words.
const QuestionOption = (props: { value: string; text: string; choice: string | null; onChoose: (value: string) => void }): ReactElement => {
  return (
    <label className="inline q-option">
      <input type="radio" name="question" value={props.value} checked={props.choice === props.value} onChange={() => { props.onChoose(props.value); }} />
      <span>{props.text}</span>
    </label>
  );
};

// The 20 curated questions in their five groups, and a free-text choice (R10.5). A kind in leaveOutKinds is not offered, and a group
// left with no question is not shown, so a listing closed to dating questions gets no couple group (design section 11).
export const QuestionPicker = (props: { isSending: boolean; error: string | null; onCreate: (pick: QuestionPick) => void; leaveOutKinds?: readonly QuestionKind[] }): ReactElement => {
  const [choice, setChoice] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const hiddenKinds = props.leaveOutKinds ?? [];
  const groups = QUESTION_GROUPS.filter((group) => group.kinds.some((kind) => !hiddenKinds.includes(kind)));
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (choice === null) return;
    if (choice === "free") props.onCreate({ kind: "free", text: freeText });
    else props.onCreate({ kind: "curated", questionId: Number(choice) });
  };
  return (
    <form className="q-picker" onSubmit={onSubmit}>
      <fieldset>
        <legend>Pick a question for the meeting</legend>
        {groups.map((group) => (
          <div key={group.title} className={`q-group ${group.colour}`} role="group" aria-label={group.title}>
            <p className="q-group-title">
              <span className="dot" aria-hidden="true" />
              {group.title}
            </p>
            {CURATED_QUESTIONS.filter((question) => group.kinds.includes(question.kind) && !hiddenKinds.includes(question.kind)).map((question) => (
              <QuestionOption key={question.id} value={String(question.id)} text={question.text} choice={choice} onChoose={setChoice} />
            ))}
          </div>
        ))}
        <div className="q-group q-own">
          <QuestionOption value="free" text="Write your own question" choice={choice} onChoose={setChoice} />
          {choice === "free" ? (
            <label>
              {FREE_TEXT_LABEL}
              <textarea maxLength={FREE_TEXT_MAX_CHARS} value={freeText} onChange={(event) => { setFreeText(event.target.value); }} />
            </label>
          ) : null}
        </div>
        <div className="q-submit">
          <button type="submit" className="big" disabled={choice === null || props.isSending}>
            Create the meeting
          </button>
        </div>
      </fieldset>
      {props.error === null ? null : (
        <div className="notice" role="alert">
          <p>{props.error}</p>
        </div>
      )}
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
    <section className="meeting-list">
      <h2>Meetings</h2>
      <ul className="meeting-rows">
        {props.meetings.map((meeting) => (
          <li key={meeting.id}>
            <p className="meeting-question">{meeting.questionText}</p>
            <div className="meeting-row-foot">
              <span className={`pill meeting-state is-${meeting.state}`}>{meetingStateLine(meeting)}</span>
              {meeting.state === "running" || meeting.state === "ended" ? <Link to={meetingPathWithSide(meeting.id, readViewerSide(meeting.id))}>Open the meeting</Link> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

// One row per member: the initial in the side's colour, then the name, whether they said ready, and whether they are watching now.
const MemberLines = (props: { meeting: MeetingView }): ReactElement => {
  return (
    <ul className="member-rows">
      {props.meeting.members.map((member) => (
        <li key={member.side} className={member.ready ? "is-ready" : undefined}>
          <Avatar name={member.displayName} side={member.side} isSmall />
          <p>{`${member.displayName}: ${member.ready ? "ready" : "not ready yet"}, ${member.connected ? "watching now" : "not watching now"}`}</p>
          {member.ready ? <Sticker name="check" className="member-check" /> : null}
        </li>
      ))}
    </ul>
  );
};

// The line under the members while the meeting waits: both ready, or the other person still to say ready.
const ReadyNote = (props: { meeting: MeetingView }): ReactElement | null => {
  const isBothReady = props.meeting.members.every((member) => member.ready);
  if (props.meeting.state !== "ready") return null;
  if (isBothReady) return <LoadingLine text="Both of you have said ready. The meeting starts by itself." />;
  return <p className="ready-note">Waiting for the other person to say ready.</p>;
};

// The next meeting: its question, both members' ready and watching marks, and the ready button (D53, R10.5).
export const StartPanel = (props: { meeting: MeetingView; isBusy: boolean; error: ApiError | null; onReady: () => void }): ReactElement => {
  const { meeting } = props;
  const viewer = meeting.members.find((member) => member.side === meeting.viewerSide);
  const isViewerWaiting = viewer !== undefined && !viewer.ready && meeting.state === "ready";
  return (
    <section className={`start-panel ${kindColour(meeting.questionKind)}`}>
      <h2>The next meeting</h2>
      <p className="start-question">{meeting.questionText}</p>
      {meeting.questionChecked ? null : <LoadingLine text="Checking the question." />}
      <MemberLines meeting={meeting} />
      {meeting.state === "queued" && meeting.queuePosition !== undefined ? <LoadingLine text={`All rooms are busy. You are number ${String(meeting.queuePosition)} in the queue.`} /> : null}
      <ReadyNote meeting={meeting} />
      {isViewerWaiting ? (
        <div className="actions">
          <button type="button" className="big" disabled={props.isBusy} onClick={props.onReady}>
            I'm ready
          </button>
        </div>
      ) : null}
      {props.error === null ? null : <ErrorNotice error={props.error} />}
    </section>
  );
};
