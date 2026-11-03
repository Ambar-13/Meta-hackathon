import "./me.css";
import { useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HomeView, MyListing } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame, type PolledView } from "../../app-shell/index.js";
import { LoadingLine } from "../../look/index.js";
import { useYourListing, type YourListingHook } from "../directory/index.js";
import { useHomeView } from "../home/index.js";
import { ProfileHeader, ProfileTabs, useProfile } from "../people/index.js";
import { AddChats, EditListing, JoinExplore, MeMeetings, MeNext } from "./me-parts.js";

// The words of /me (wave 7).
const ME_SCREEN_COPY = {
  title: "Me",
  loading: "Opening your profile.",
  loadingHome: "Opening your next step.",
  editListing: "Edit profile",
  yourCard: "Your card",
  notListed: "You are not in Explore yet. Join so friends can find you.",
  source: "In your own words",
} as const;

// What /me shows under your profile from GET /api/home: the next step, the end of the About tab, and the Meetings tab's panel.
type MeBelow = { next: ReactNode; aboutEnd: ReactNode; meetings: ReactNode };

// Your profile when you are in Explore: the header as others see it (GET /api/directory/:id, friendship self) with Edit my listing
// and Your card, your listing controls under it while open, the next step, then the tabs.
const ListedMe = (props: { listing: MyListing; home: HomeView | null; yours: YourListingHook; below: MeBelow }): ReactElement => {
  const { listing } = props;
  const model = useProfile(listing.listingId);
  const profile = model.profile.value;
  const [isEditing, setIsEditing] = useState(false);
  const onSaved = (saved: MyListing): void => {
    props.yours.replaceListing(saved);
    model.profile.reload();
  };
  return (
    <>
      <ProfileHeader name={profile?.displayName ?? props.home?.displayName ?? ME_SCREEN_COPY.title} line={profile?.line ?? listing.line}>
        <button type="button" className="quiet" aria-expanded={isEditing} onClick={() => { setIsEditing(!isEditing); }}>{ME_SCREEN_COPY.editListing}</button>
        <Link className="btn quiet" to={APP_PATHS.card(listing.cardId)}>{ME_SCREEN_COPY.yourCard}</Link>
      </ProfileHeader>
      {isEditing ? <EditListing listing={listing} yours={props.yours} onSaved={onSaved} /> : null}
      {props.below.next}
      <ProfileTabs items={profile?.items ?? listing.items} source={ME_SCREEN_COPY.source} postsName={null} aboutEnd={props.below.aboutEnd} meetings={props.below.meetings} />
    </>
  );
};

// Your profile when you are not in Explore: your name, the line that says so, the join controls once your card is approved, the next
// step, then the tabs.
const UnlistedMe = (props: { home: HomeView | null; yours: YourListingHook; below: MeBelow }): ReactElement => {
  return (
    <>
      <ProfileHeader name={props.home?.displayName ?? ME_SCREEN_COPY.title} line={null}>
        <p className="profile-note">{ME_SCREEN_COPY.notListed}</p>
      </ProfileHeader>
      <JoinExplore home={props.home} yours={props.yours} />
      {props.below.next}
      <ProfileTabs items={[]} source={ME_SCREEN_COPY.source} postsName={null} aboutEnd={props.below.aboutEnd} meetings={props.below.meetings} />
    </>
  );
};

// The next step, the end of About and the Meetings panel from the home view; while it loads, or when it fails, its loading line or
// error. Add more chats shows only once there is a card: before that the next step is the way to add your notes.
function belowFrom(home: PolledView<HomeView>, fromExplore: ReadonlySet<string>): MeBelow {
  if (home.value === null) {
    const state = home.error === null ? <LoadingLine text={ME_SCREEN_COPY.loadingHome} /> : <ErrorNotice error={home.error} />;
    return { next: state, aboutEnd: null, meetings: state };
  }
  return {
    next: <MeNext home={home.value} />,
    aboutEnd: home.value.card === null ? null : <AddChats />,
    meetings: <MeMeetings home={home.value} fromExplore={fromExplore} />,
  };
}

// /me, after Instagram's own profile: your profile as others see it with Edit my listing and Your card, the one next step, then the
// About, Posts and Meetings tabs. Nothing shows twice: your card is the About tab and the header's button, your meetings are one list
// that marks the ones someone started with you in Explore, and Settings is the gear in the frame.
export const MeScreen = (): ReactElement => {
  const yours = useYourListing();
  const home = useHomeView();
  const { load } = yours;
  const isReady = load.kind === "ready";
  const below = belowFrom(home, new Set(isReady ? load.meetings.map((meeting) => meeting.meetingId) : []));
  return (
    <ScreenFrame title={ME_SCREEN_COPY.title} hasOwnHeading={isReady} isWide>
      <div className="profile-page">
        {load.kind === "loading" ? <LoadingLine text={ME_SCREEN_COPY.loading} /> : null}
        {load.kind === "failed" ? <><ErrorNotice error={load.error} />{below.next}</> : null}
        {isReady && load.listing !== null ? <ListedMe listing={load.listing} home={home.value} yours={yours} below={below} /> : null}
        {isReady && load.listing === null ? <UnlistedMe home={home.value} yours={yours} below={below} /> : null}
      </div>
    </ScreenFrame>
  );
};
