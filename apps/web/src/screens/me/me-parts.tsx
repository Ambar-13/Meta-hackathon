import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { DIRECTORY_SWITCH_COPY, LISTING_LINE_MAX_CHARS, ROMANCE_SWITCH_COPY, type HomeView, type ListedMeeting, type MyListing } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice } from "../../app-shell/index.js";
import { PersonAvatar } from "../../look/index.js";
import { MEETING_STATE_LABELS } from "../lobby/index.js";
import type { YourListingHook } from "../directory/index.js";
import { useListingSave, type ListingSaveState } from "./me-state.js";

// The words of your listing's controls on /me (wave 7).
const ME_COPY = {
  lineLabel: "Your line in Explore (up to 140 characters)",
  save: "Save my listing",
  join: "Join Explore",
  saved: "Saved. People in Explore see this now.",
  leave: "Leave Explore",
  left: "You left Explore. Meetings already made stay below.",
  pickPublic: "Choose which items are public on your card",
  needCard: "Approve your card first, then come back here to join.",
  openCard: "Open my card",
  addChats: "Add your chats",
  meetingsHeading: "Meetings your persona was in",
  openMeeting: "Open the meeting",
  readBrief: "Read the brief",
} as const;

// The line under a join or a save: the refusal, the api's sentence, or that it saved.
const SaveLine = (props: { state: ListingSaveState }): ReactElement | null => {
  const { state } = props;
  if (state.kind === "refused") return <p className="me-refusal" role="alert">{state.sentence}</p>;
  if (state.kind === "failed") return <ErrorNotice error={state.error} />;
  if (state.kind === "saved") return <p role="status">{ME_COPY.saved}</p>;
  return null;
};

// The line and the dating switch, with the button that joins Explore or saves; the consent words show above a join.
const ListingForm = (props: { cardId: string; listing: MyListing | null; submitLabel: string; onSaved: (listing: MyListing) => void }): ReactElement => {
  const [line, setLine] = useState(props.listing?.line ?? "");
  const [isOpen, setIsOpen] = useState(props.listing?.openToRomance ?? false);
  const saver = useListingSave(props.onSaved);
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void saver.save({ cardId: props.cardId, line, openToRomance: isOpen });
  };
  return (
    <form className="me-listing-form" onSubmit={onSubmit}>
      <label>
        {ME_COPY.lineLabel}
        <input type="text" maxLength={LISTING_LINE_MAX_CHARS} value={line} onChange={(event) => { setLine(event.target.value); }} />
      </label>
      <label className="inline">
        <input type="checkbox" checked={isOpen} onChange={(event) => { setIsOpen(event.target.checked); }} />
        <span>{ROMANCE_SWITCH_COPY}</span>
      </label>
      {props.listing === null ? <p className="hint">{DIRECTORY_SWITCH_COPY}</p> : null}
      <button type="submit" disabled={saver.state.kind === "sending"}>{props.submitLabel}</button>
      <SaveLine state={saver.state} />
    </form>
  );
};

// Your listing's controls, opened by Edit my listing: the line, the dating switch, and Leave, which deletes the listing at once (P2).
export const EditListing = (props: { listing: MyListing; yours: YourListingHook; onSaved: (listing: MyListing) => void }): ReactElement => {
  const { leaveState } = props.yours;
  return (
    <section className="me-edit" aria-label="Your listing">
      <ListingForm cardId={props.listing.cardId} listing={props.listing} submitLabel={ME_COPY.save} onSaved={props.onSaved} />
      <Link to={APP_PATHS.card(props.listing.cardId)}>{ME_COPY.pickPublic}</Link>
      <div className="actions">
        <button type="button" className="quiet" disabled={leaveState.kind === "sending"} onClick={() => void props.yours.leave()}>{ME_COPY.leave}</button>
      </div>
      {leaveState.kind === "failed" ? <ErrorNotice error={leaveState.error} /> : null}
    </section>
  );
};

// The join controls for a person who is not in Explore: the line, the dating switch and Join, from their approved card.
export const JoinExplore = (props: { home: HomeView | null; yours: YourListingHook }): ReactElement | null => {
  const card = props.home?.card ?? null;
  const hasLeft = props.yours.leaveState.kind === "left";
  if (props.home === null) return hasLeft ? <p role="status">{ME_COPY.left}</p> : null;
  return (
    <section className="me-edit" aria-label="Join Explore">
      {hasLeft ? <p role="status">{ME_COPY.left}</p> : null}
      {card?.state === "approved" ? (
        <>
          <ListingForm cardId={card.id} listing={null} submitLabel={ME_COPY.join} onSaved={props.yours.replaceListing} />
          <Link to={APP_PATHS.card(card.id)}>{ME_COPY.pickPublic}</Link>
        </>
      ) : (
        <>
          <p className="me-need-card">{ME_COPY.needCard}</p>
          <Link className="btn quiet" to={card === null ? APP_PATHS.upload : APP_PATHS.card(card.id)}>{card === null ? ME_COPY.addChats : ME_COPY.openCard}</Link>
        </>
      )}
    </section>
  );
};

// The links of one listed meeting: its meeting page unless it is gone, and its brief page once it has ended.
const ListedMeetingLinks = (props: { meeting: ListedMeeting }): ReactElement | null => {
  const { meeting } = props;
  if (meeting.state === "deleted") return null;
  return (
    <div className="listed-links">
      <Link className="btn quiet" to={APP_PATHS.meeting(meeting.meetingId)}>{ME_COPY.openMeeting}</Link>
      {meeting.state === "ended" ? <Link className="btn quiet" to={APP_PATHS.brief(meeting.meetingId)}>{ME_COPY.readBrief}</Link> : null}
    </div>
  );
};

// The meetings your persona was in through Explore, newest first as the server sends them (P4); nothing shows when there are none.
export const ListedMeetingList = (props: { meetings: ListedMeeting[] }): ReactElement | null => {
  if (props.meetings.length === 0) return null;
  return (
    <section aria-labelledby="me-listed-title">
      <h2 id="me-listed-title">{ME_COPY.meetingsHeading}</h2>
      <ul className="listed-meetings">
        {props.meetings.map((meeting) => (
          <li key={meeting.meetingId}>
            <PersonAvatar name={meeting.otherDisplayName} />
            <div className="listed-body">
              <p className="listed-question">{`${meeting.otherDisplayName}: ${meeting.questionText}`}</p>
              <span className="pill">{MEETING_STATE_LABELS[meeting.state]}</span>
              <ListedMeetingLinks meeting={meeting} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
