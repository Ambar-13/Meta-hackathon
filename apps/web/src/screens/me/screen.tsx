import "./me.css";
import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { HomeView, MyListing } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame, type PolledView } from "../../app-shell/index.js";
import { LoadingLine } from "../../look/index.js";
import { useYourListing, type YourListingHook } from "../directory/index.js";
import { CardSection, MeetingsSection, NextStepPanel, PairsSection, useHomeView } from "../home/index.js";
import { ProfileHeader, ProfileTabs, useProfile } from "../people/index.js";
import { EditListing, JoinExplore, ListedMeetingList } from "./me-parts.js";

// The words of /me (wave 7).
const ME_SCREEN_COPY = {
  title: "Me",
  loading: "Opening your profile.",
  loadingHome: "Opening your home.",
  editListing: "Edit my listing",
  notListed: "You are not in Explore yet. Join so friends can find you.",
  source: "In your own words",
  yourCard: "Your card",
  addChats: "Add more chats",
  settings: "Settings",
  linksLabel: "More about you",
} as const;

// Your profile when you are in Explore: the header as others see it (GET /api/directory/:id, friendship self), Edit my listing
// opening your listing controls under it, then the tabs with your own Posts words.
const ListedMe = (props: { listing: MyListing; home: HomeView | null; yours: YourListingHook }): ReactElement => {
  const { listing } = props;
  const model = useProfile(listing.listingId);
  const profile = model.profile.value;
  const [isEditing, setIsEditing] = useState(false);
  const onSaved = (saved: MyListing): void => {
    props.yours.replaceListing(saved);
    model.profile.reload();
  };
  const items = profile?.items ?? listing.items;
  return (
    <>
      <ProfileHeader name={profile?.displayName ?? props.home?.displayName ?? ME_SCREEN_COPY.title} line={profile?.line ?? listing.line} itemCount={items.length}>
        <button type="button" aria-expanded={isEditing} onClick={() => { setIsEditing(!isEditing); }}>{ME_SCREEN_COPY.editListing}</button>
      </ProfileHeader>
      {isEditing ? <EditListing listing={listing} yours={props.yours} onSaved={onSaved} /> : null}
      <ProfileTabs items={items} source={ME_SCREEN_COPY.source} postsName={null} />
    </>
  );
};

// Your profile when you are not in Explore: your name tag and name, the line that says so, the join controls, then the tabs.
const UnlistedMe = (props: { home: HomeView | null; yours: YourListingHook }): ReactElement => {
  return (
    <>
      <ProfileHeader name={props.home?.displayName ?? ME_SCREEN_COPY.title} line={null} itemCount={null}>
        <p className="profile-note">{ME_SCREEN_COPY.notListed}</p>
      </ProfileHeader>
      <JoinExplore home={props.home} yours={props.yours} />
      <ProfileTabs items={[]} source={ME_SCREEN_COPY.source} postsName={null} />
    </>
  );
};

// Today's home sections under your profile: the next step, your card, your meetings and your open invites.
const HomeSections = (props: { home: PolledView<HomeView> }): ReactElement => {
  const { value, error } = props.home;
  if (value === null) return error === null ? <LoadingLine text={ME_SCREEN_COPY.loadingHome} /> : <ErrorNotice error={error} />;
  return (
    <>
      <NextStepPanel home={value} />
      <CardSection home={value} />
      <MeetingsSection home={value} />
      <PairsSection home={value} />
    </>
  );
};

// The links at the foot of /me: your card when there is one, adding more chats, and Settings.
const MeLinks = (props: { home: HomeView | null }): ReactElement => {
  const card = props.home?.card ?? null;
  return (
    <nav className="me-links" aria-label={ME_SCREEN_COPY.linksLabel}>
      {card === null ? null : <Link className="chip c-coral" to={APP_PATHS.card(card.id)}>{ME_SCREEN_COPY.yourCard}</Link>}
      <Link className="chip c-blue" to={APP_PATHS.upload}>{ME_SCREEN_COPY.addChats}</Link>
      <Link className="chip c-lilac" to={APP_PATHS.settings}>{ME_SCREEN_COPY.settings}</Link>
    </nav>
  );
};

// /me: your own profile as others see it, your listing controls, today's home sections, and links to your card, upload and Settings.
export const MeScreen = (): ReactElement => {
  const yours = useYourListing();
  const home = useHomeView();
  const { load } = yours;
  const isReady = load.kind === "ready";
  return (
    <ScreenFrame title={ME_SCREEN_COPY.title} hasOwnHeading={isReady} isWide>
      <div className="profile-page">
        {load.kind === "loading" ? <LoadingLine text={ME_SCREEN_COPY.loading} /> : null}
        {load.kind === "failed" ? <ErrorNotice error={load.error} /> : null}
        {isReady && load.listing !== null ? <ListedMe listing={load.listing} home={home.value} yours={yours} /> : null}
        {isReady && load.listing === null ? <UnlistedMe home={home.value} yours={yours} /> : null}
        <div className="me-home">
          <HomeSections home={home} />
          {isReady ? <ListedMeetingList meetings={load.meetings} /> : null}
        </div>
        <MeLinks home={home.value} />
      </div>
    </ScreenFrame>
  );
};
