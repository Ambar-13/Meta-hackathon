import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { DIRECTORY_SWITCH_COPY, DISPLAY_NAME_MAX_CHARS, LISTING_LINE_MAX_CHARS, ROMANCE_SWITCH_COPY, type HomeView, type MyListing } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice } from "../../app-shell/index.js";
import { EmptyState, Icon, PersonAvatar } from "../../look/index.js";
import type { YourListingHook } from "../directory/index.js";
import { meetingLink, meetingStateWords, nextStepOf, shortDay } from "../home/index.js";
import { useListingSave, type EditState, type ListingSaveState, type ProfileEditHook } from "./me-state.js";

// The words of your listing's controls, your next step and your meetings on /me.
const ME_COPY = {
  lineLabel: "Your line in Explore",
  save: "Save my listing",
  join: "Join Explore",
  saved: "Saved. People in Explore see this now.",
  leave: "Leave Explore",
  left: "You left Explore. Your meetings stay in the Meetings tab.",
  pickPublic: "Choose which items are public on your card",
  nextLabel: "Your next step",
  noMeetings: "No meetings yet",
  noMeetingsLine: "Your first one starts from an invite or Explore.",
  fromExplore: "From Explore",
  invitesHeading: "Open invites",
  waiting: "Waiting for someone to join",
  addChats: "Add more chats",
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

// Your listing's controls, opened by Edit my listing: the line, the dating switch, and Leave, which deletes the listing at once.
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

// The line under a change in Edit profile: the refusal, the api's sentence, or that it is done.
const EditLine = (props: { state: EditState }): ReactElement | null => {
  const { state } = props;
  if (state.kind === "refused") return <p className="me-refusal" role="alert">{state.sentence}</p>;
  if (state.kind === "failed") return <ErrorNotice error={state.error} />;
  if (state.kind === "done") return <p className="me-done" role="status">{state.sentence}</p>;
  return null;
};

// Instagram's Edit profile: your picture with Change photo, which
// opens your photos or camera, and Remove photo while you have one; then your name with Save name. The photo is drawn as a square.
export const EditProfile = (props: { name: string; photo: string | null; edit: ProfileEditHook }): ReactElement => {
  const { edit } = props;
  const [text, setText] = useState(props.name);
  const isPhotoBusy = edit.photo.kind === "sending";
  const onName = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void edit.saveName(text);
  };
  return (
    <section className="me-edit me-profile" aria-label="Edit profile">
      <div className="me-photo">
        <PersonAvatar name={props.name} size="l" photo={props.photo} />
        <div className="me-photo-actions">
          <label className={isPhotoBusy ? "btn quiet me-photo-pick is-busy" : "btn quiet me-photo-pick"}>
            {props.photo === null ? "Add a photo" : "Change photo"}
            <input type="file" accept="image/*" className="me-file" disabled={isPhotoBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) void edit.putPhoto(file);
              }} />
          </label>
          {props.photo === null ? null : (
            <button type="button" className="text-button" disabled={isPhotoBusy} onClick={() => void edit.removePhoto()}>Remove photo</button>
          )}
        </div>
      </div>
      <EditLine state={edit.photo} />
      <form className="me-name" onSubmit={onName}>
        <label>
          Name
          <input type="text" value={text} maxLength={DISPLAY_NAME_MAX_CHARS} autoComplete="name" onChange={(event) => { setText(event.target.value); }} />
        </label>
        <button type="submit" className="quiet" disabled={edit.name.kind === "sending"}>{edit.name.kind === "sending" ? "Saving" : "Save name"}</button>
      </form>
      <EditLine state={edit.name} />
    </section>
  );
};

// The join controls for a person who is not in Explore, from their approved card: the line, the dating switch and Join. Before the
// card is approved nothing shows here, since the next step under it already says what to do first.
export const JoinExplore = (props: { home: HomeView | null; yours: YourListingHook }): ReactElement | null => {
  const card = props.home?.card ?? null;
  const hasLeft = props.yours.leaveState.kind === "left";
  const joinable = card !== null && card.state === "approved" ? card : null;
  if (!hasLeft && joinable === null) return null;
  return (
    <section className="me-edit" aria-label="Join Explore">
      {hasLeft ? <p role="status">{ME_COPY.left}</p> : null}
      {joinable === null ? null : (
        <>
          <ListingForm cardId={joinable.id} listing={null} submitLabel={ME_COPY.join} onSaved={props.yours.replaceListing} />
          <Link to={APP_PATHS.card(joinable.id)}>{ME_COPY.pickPublic}</Link>
        </>
      )}
    </section>
  );
};

// The one next step, flat between your profile and the tabs: what it is, why, its button (the page's one blue), and a second link
// when there is a real choice.
export const MeNext = (props: { home: HomeView }): ReactElement => {
  const step = nextStepOf(props.home);
  return (
    <section className="me-next" aria-labelledby="me-next-title">
      <p className="me-next-label">{ME_COPY.nextLabel}</p>
      <h2 id="me-next-title">{step.title}</h2>
      {step.text === "" ? null : <p className="me-next-text">{step.text}</p>}
      <div className="me-next-actions">
        <Link className="btn" to={step.action.to}>{step.action.label}</Link>
        {step.second === undefined ? null : <Link to={step.second.to}>{step.second.label}</Link>}
      </div>
    </section>
  );
};

// The invites still open, each a row back to its lobby; nothing shows when there are none.
const OpenInvites = (props: { home: HomeView }): ReactElement | null => {
  const { pairs, serverNow } = props.home;
  if (pairs.length === 0) return null;
  return (
    <section className="me-invites" aria-labelledby="me-invites-title">
      <h3 id="me-invites-title">{ME_COPY.invitesHeading}</h3>
      <ul className="me-rows">
        {pairs.map((pair) => (
          <li key={pair.id}>
            <Link className="me-row" to={APP_PATHS.lobby(pair.id)}>
              {pair.otherDisplayName === null ? <span className="me-row-icon"><Icon name="add" size={20} /></span> : <PersonAvatar name={pair.otherDisplayName} />}
              <span>
                <b>{pair.otherDisplayName === null ? ME_COPY.waiting : `With ${pair.otherDisplayName}`}</b>
                <small>{`Open until ${shortDay(pair.expiresAt, serverNow)}`}</small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

// The Meetings tab: every meeting you are in, newest first, one list, each a row to its brief once ready or else to the meeting, with
// where it stands, its day, and From Explore when someone met you there; then the invites still open.
export const MeMeetings = (props: { home: HomeView; fromExplore: ReadonlySet<string> }): ReactElement => {
  const { meetings, serverNow } = props.home;
  return (
    <div className="me-meetings">
      {meetings.length === 0 ? <EmptyState sticker="chat" title={ME_COPY.noMeetings}>{ME_COPY.noMeetingsLine}</EmptyState> : (
        <ul className="me-rows">
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <Link className="me-row" to={meetingLink(meeting)}>
                <PersonAvatar name={meeting.otherDisplayName} />
                <span>
                  <b>{`With ${meeting.otherDisplayName}: ${meeting.questionText}`}</b>
                  <small>
                    {[meetingStateWords(meeting), shortDay(meeting.createdAt, serverNow), props.fromExplore.has(meeting.id) ? ME_COPY.fromExplore : ""]
                      .filter((part) => part !== "")
                      .join(" · ")}
                  </small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <OpenInvites home={props.home} />
    </div>
  );
};

// The end of your About tab: your card grows from your chats, so adding more starts here.
export const AddChats = (): ReactElement => {
  return <Link className="me-add-chats" to={APP_PATHS.upload}>{ME_COPY.addChats}</Link>;
};
