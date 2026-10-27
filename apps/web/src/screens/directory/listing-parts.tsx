import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing, ListedMeeting, MyListing, PublicItem } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice } from "../../app-shell/index.js";
import { Avatar, EmptyState, LoadingLine, NameTag, Receipt, Sticker } from "../../look/index.js";
import { KIND_LABELS } from "../card/index.js";
import { MEETING_STATE_LABELS, QuestionPicker } from "../lobby/index.js";
import { leaveOutKindsFor, type MeetControls, type YourListingHook, type YourListingLoad } from "./directory-state.js";

// The words a listing open to dating questions shows (design section 11).
const OPEN_TO_ROMANCE_COPY = "Open to dating questions";
// The words of the Your listing part that no input gives [confirm] (drafted copy).
const YOUR_LISTING_COPY = {
  loading: "Reading your listing.",
  listed: "People in the directory see this line and these items:",
  notListed: "You are not in the directory. To join, open your approved card and turn on the directory switch.",
  notListedTitle: "You are not listed",
  left: "You left the directory. Meetings already made stay below.",
  meetingsHeading: "Meetings your persona was in",
  noMeetingsTitle: "No meetings yet",
  noMeetings: "Your persona has not met anyone through the directory yet.",
  openMeeting: "Open the meeting",
  readBrief: "Read the brief",
} as const;
// The most public items a listing card shows, so every card stays short enough to scan (design pass).
const ITEMS_ON_A_CARD = 3;

// The public items of a listing, each as its kind and claim with its quote under it; nothing else of the card is shown (P6).
const PublicItemList = (props: { items: PublicItem[]; source: string }): ReactElement => {
  return (
    <ul className="listing-items">
      {props.items.map((item, index) => (
        <li key={`${String(index)}-${item.claim}`}>
          <p className="listing-claim">
            <span className="chip">{KIND_LABELS[item.kind]}</span> <span>{item.claim}</span>
          </p>
          <Receipt quote={item.quote} source={props.source} />
        </li>
      ))}
    </ul>
  );
};

// The Meet button of one listing and, while open, the lobby's picker without the kinds this listing does not take (design sections 7 and 11).
const MeetPanel = (props: { listing: DirectoryListing; meet: MeetControls }): ReactElement => {
  const { listing, meet } = props;
  const isOpen = meet.state.openListingId === listing.listingId;
  return (
    <div className="listing-meet">
      <button type="button" className={isOpen ? "quiet" : undefined} aria-expanded={isOpen} aria-label={`Meet ${listing.displayName}`} onClick={() => { meet.toggle(listing.listingId); }}>
        Meet
      </button>
      {isOpen ? (
        <QuestionPicker isSending={meet.state.isSending} error={meet.state.error} leaveOutKinds={leaveOutKindsFor(listing)} onCreate={(pick) => void meet.create(listing.listingId, pick)} />
      ) : null}
    </div>
  );
};

// One listing as anyone in the directory sees it: a name tag, the line, the dating words when open, up to three public items, and
// Meet when a card is known.
export const ListingCard = (props: { listing: DirectoryListing; meet: MeetControls | null }): ReactElement => {
  const { listing } = props;
  return (
    <li className="panel listing-card">
      <div className="listing-head">
        <div className="listing-words">
          <h3>{listing.displayName}</h3>
          <p className="listing-line">{listing.line}</p>
          {listing.openToRomance ? <p className="listing-open">{OPEN_TO_ROMANCE_COPY}</p> : null}
        </div>
        <NameTag name={listing.displayName} colour="green" className="listing-tag wide" />
      </div>
      <PublicItemList items={listing.items.slice(0, ITEMS_ON_A_CARD)} source={`${listing.displayName}, in their own words`} />
      {props.meet === null ? null : <MeetPanel listing={listing} meet={props.meet} />}
    </li>
  );
};

// The person's listing as people in the directory see it, with the one-tap Leave button (P2: leaving deletes the listing at once).
const ListedBody = (props: { listing: MyListing; isSending: boolean; onLeave: () => void }): ReactElement => {
  return (
    <div className="colour-panel c-lilac your-listing">
      <Sticker name="tags" className="your-listing-sticker" />
      <p className="your-listing-intro">{YOUR_LISTING_COPY.listed}</p>
      <p className="listing-line">{props.listing.line}</p>
      {props.listing.openToRomance ? <p className="listing-open">{OPEN_TO_ROMANCE_COPY}</p> : null}
      <PublicItemList items={props.listing.items} source="In your own words" />
      <button type="button" className="quiet" disabled={props.isSending} onClick={props.onLeave}>
        Leave the directory
      </button>
    </div>
  );
};

// The links of one listed meeting: its meeting page unless it is gone, and its brief page once it has ended.
const ListedMeetingLinks = (props: { meeting: ListedMeeting }): ReactElement | null => {
  const { meeting } = props;
  if (meeting.state === "deleted") return null;
  return (
    <div className="listed-links">
      <Link className="btn quiet" to={APP_PATHS.meeting(meeting.meetingId)}>{YOUR_LISTING_COPY.openMeeting}</Link>
      {meeting.state === "ended" ? <Link className="btn quiet" to={APP_PATHS.brief(meeting.meetingId)}>{YOUR_LISTING_COPY.readBrief}</Link> : null}
    </div>
  );
};

// The meetings the person's persona was in through the directory, newest first as the server sends them (P4).
const ListedMeetingList = (props: { meetings: ListedMeeting[] }): ReactElement => {
  return (
    <>
      <h3>{YOUR_LISTING_COPY.meetingsHeading}</h3>
      {props.meetings.length === 0 ? (
        <EmptyState sticker="chat" title={YOUR_LISTING_COPY.noMeetingsTitle}>
          {YOUR_LISTING_COPY.noMeetings}
        </EmptyState>
      ) : null}
      <ul className="listed-meetings">
        {props.meetings.map((meeting) => (
          <li key={meeting.meetingId}>
            <Avatar name={meeting.otherDisplayName} side="b" />
            <div className="listed-body">
              <p className="listed-question">{`${meeting.otherDisplayName}: ${meeting.questionText}`}</p>
              <span className="pill">{MEETING_STATE_LABELS[meeting.state]}</span>
              <ListedMeetingLinks meeting={meeting} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
};

// The loaded Your listing part: listed or not, what Leave did, and the meetings the persona was in.
const YourListingBody = (props: { yours: YourListingHook; ready: Extract<YourListingLoad, { kind: "ready" }> }): ReactElement => {
  const { leaveState } = props.yours;
  const { listing } = props.ready;
  return (
    <>
      {listing === null ? (
        <EmptyState sticker="tags" title={YOUR_LISTING_COPY.notListedTitle}>
          {YOUR_LISTING_COPY.notListed}
        </EmptyState>
      ) : (
        <ListedBody listing={listing} isSending={leaveState.kind === "sending"} onLeave={() => void props.yours.leave()} />
      )}
      {leaveState.kind === "left" ? <p className="soft-panel c-green" role="status">{YOUR_LISTING_COPY.left}</p> : null}
      {leaveState.kind === "failed" ? <ErrorNotice error={leaveState.error} /> : null}
      <ListedMeetingList meetings={props.ready.meetings} />
    </>
  );
};

// The Your listing part of the directory page (design section 7).
export const YourListingSection = (props: { yours: YourListingHook }): ReactElement => {
  const { load } = props.yours;
  return (
    <section className="your-listing-section" aria-labelledby="your-listing-title">
      <h2 id="your-listing-title">Your listing</h2>
      {load.kind === "loading" ? <LoadingLine text={YOUR_LISTING_COPY.loading} /> : null}
      {load.kind === "failed" ? <ErrorNotice error={load.error} /> : null}
      {load.kind === "ready" ? <YourListingBody yours={props.yours} ready={load} /> : null}
    </section>
  );
};
