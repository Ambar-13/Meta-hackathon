import "./me.css";
import { useState, type ReactElement, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { HomeView, MyListing, MyPostsView, ProfileView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, readProfileTab, ScreenFrame, type PolledView } from "../../app-shell/index.js";
import { LoadingLine } from "../../look/index.js";
import { useYourListing, type YourListingHook } from "../directory/index.js";
import { useHomeView } from "../home/index.js";
import { ProfileHeader, ProfileTabs, useProfile } from "../people/index.js";
import { SummarySection, useSummary, type SummaryHook } from "../summary/index.js";
import { AddChats, EditListing, EditProfile, JoinExplore, MeMeetings, MeNext } from "./me-parts.js";
import { TryMeety } from "./try-meety.js";
import { useMyPosts, useProfileEdit } from "./me-state.js";

// The words of /me.
const ME_SCREEN_COPY = {
  title: "Me",
  loading: "Opening your profile.",
  loadingHome: "Opening your next step.",
  editListing: "Edit profile",
  yourCard: "Your card",
  notListed: "You are not in Explore yet. Join so friends can find you.",
  source: "In your own words",
} as const;

// What /me shows under your profile from GET /api/home: the next step, the end of the About tab, and the Meetings tab's panel; your own
// posts for the Posts tab; and the tab the address asks for.
type MeBelow = { next: ReactNode; aboutEnd: ReactNode; meetings: ReactNode; posts: PolledView<MyPostsView>; firstTab: "about" | "posts" };

// What your header shows when you are in Explore: your name and line as Explore shows them once read, else from your home view and your
// listing, and your photo.
function listedHeader(profile: ProfileView | null, home: HomeView | null, listing: MyListing): { name: string; line: string; photo: string | null } {
  return { name: profile?.displayName ?? home?.displayName ?? ME_SCREEN_COPY.title, line: profile?.line ?? listing.line, photo: home?.photo ?? null };
}

// Your profile when you are in Explore: the header as others see it (GET /api/directory/:id, friendship self) with Edit profile and
// Your card; while Edit profile is open, your photo and name, then your listing's line and dating switch; the next step, then the tabs.
const ListedMe = (props: { listing: MyListing; home: HomeView | null; yours: YourListingHook; below: MeBelow; onChanged: () => void }): ReactElement => {
  const { listing } = props;
  const model = useProfile(listing.listingId);
  const profile = model.profile.value;
  const [isEditing, setIsEditing] = useState(false);
  const edit = useProfileEdit(() => {
    props.onChanged();
    model.profile.reload();
  });
  const onSaved = (saved: MyListing): void => {
    props.yours.replaceListing(saved);
    model.profile.reload();
  };
  const { name, line, photo } = listedHeader(profile, props.home, listing);
  return (
    <>
      <ProfileHeader name={name} line={line} photo={photo}>
        <button type="button" className="quiet" aria-expanded={isEditing} onClick={() => { setIsEditing(!isEditing); }}>{ME_SCREEN_COPY.editListing}</button>
        <Link className="btn quiet" to={APP_PATHS.card(listing.cardId)}>{ME_SCREEN_COPY.yourCard}</Link>
      </ProfileHeader>
      {isEditing ? (
        <>
          <EditProfile name={name} photo={photo} edit={edit} />
          <EditListing listing={listing} yours={props.yours} onSaved={onSaved} />
        </>
      ) : null}
      {props.below.next}
      <ProfileTabs items={profile?.items ?? listing.items} source={ME_SCREEN_COPY.source} postsName={null} posts={props.below.posts} onPostDeleted={props.below.posts.reload}
        firstTab={props.below.firstTab} aboutEnd={props.below.aboutEnd} meetings={props.below.meetings} />
    </>
  );
};

// Your profile when you are not in Explore: your name and photo, the line that says so with Edit profile (your photo and name while
// open), the join controls once your card is approved, the next step, then the tabs.
const UnlistedMe = (props: { home: HomeView | null; yours: YourListingHook; below: MeBelow; onChanged: () => void }): ReactElement => {
  const [isEditing, setIsEditing] = useState(false);
  const edit = useProfileEdit(props.onChanged);
  const name = props.home?.displayName ?? ME_SCREEN_COPY.title;
  const photo = props.home?.photo ?? null;
  return (
    <>
      <ProfileHeader name={name} line={null} photo={photo}>
        <p className="profile-note">{ME_SCREEN_COPY.notListed}</p>
        {props.home === null ? null : (
          <button type="button" className="quiet" aria-expanded={isEditing} onClick={() => { setIsEditing(!isEditing); }}>{ME_SCREEN_COPY.editListing}</button>
        )}
      </ProfileHeader>
      {isEditing && props.home !== null ? <EditProfile name={name} photo={photo} edit={edit} /> : null}
      <JoinExplore home={props.home} yours={props.yours} />
      {props.below.next}
      <ProfileTabs items={[]} source={ME_SCREEN_COPY.source} postsName={null} posts={props.below.posts} onPostDeleted={props.below.posts.reload}
        firstTab={props.below.firstTab} aboutEnd={props.below.aboutEnd} meetings={props.below.meetings} />
    </>
  );
};

// The next step, the end of About and the Meetings panel from the home view; while it loads, or when it fails, its loading line or
// error. The end of About is Try your Meety once there is a card or a checked summary, then your AI's summary, with the line that asks for
// your chats when you have none; Add more chats shows only
// once there is a card: before that the next step is the way to add your notes.
function belowFrom(home: PolledView<HomeView>, fromExplore: ReadonlySet<string>, parts: Pick<MeBelow, "posts" | "firstTab"> & { summary: SummaryHook }): MeBelow {
  const { summary, ...tabs } = parts;
  if (home.value === null) {
    const state = home.error === null ? <LoadingLine text={ME_SCREEN_COPY.loadingHome} /> : <ErrorNotice error={home.error} />;
    return { next: state, aboutEnd: null, meetings: state, ...tabs };
  }
  return {
    next: <MeNext home={home.value} />,
    aboutEnd: (
      <>
        {home.value.card !== null || summary.view.value?.state === "ready" ? <TryMeety /> : null}
        <SummarySection hasChats={home.value.source !== null} summary={summary} />
        {home.value.card === null ? null : <AddChats />}
      </>
    ),
    meetings: <MeMeetings home={home.value} fromExplore={fromExplore} />,
    ...tabs,
  };
}

// /me, after Instagram's own profile: your profile as others see it with Edit my listing and Your card, the one next step, then the
// About, Posts (your own posts, with New post and Delete) and Meetings tabs, open on Posts when the address says so. Nothing shows twice: your card is the About tab and the header's button, your meetings are one list
// that marks the ones someone started with you in Explore, and Settings is the gear in the frame.
export const MeScreen = (): ReactElement => {
  const yours = useYourListing();
  const home = useHomeView();
  const posts = useMyPosts();
  const summary = useSummary();
  const location = useLocation();
  const { load } = yours;
  const isReady = load.kind === "ready";
  const below = belowFrom(home, new Set(isReady ? load.meetings.map((meeting) => meeting.meetingId) : []), { posts, firstTab: readProfileTab(location.search), summary });
  return (
    <ScreenFrame title={ME_SCREEN_COPY.title} hasOwnHeading={isReady} isWide>
      <div className="profile-page">
        {load.kind === "loading" ? <LoadingLine text={ME_SCREEN_COPY.loading} /> : null}
        {load.kind === "failed" ? <><ErrorNotice error={load.error} />{below.next}</> : null}
        {isReady && load.listing !== null ? <ListedMe listing={load.listing} home={home.value} yours={yours} below={below} onChanged={home.reload} /> : null}
        {isReady && load.listing === null ? <UnlistedMe home={home.value} yours={yours} below={below} onChanged={home.reload} /> : null}
      </div>
    </ScreenFrame>
  );
};
