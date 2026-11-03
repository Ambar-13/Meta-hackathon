import "./people.css";
import type { ReactElement } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { ProfileView } from "@meet-first/contracts";
import { APP_PATHS, chatPathWithDraft, ErrorNotice, readProfileTab, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine } from "../../look/index.js";
import { QuestionPicker } from "../lobby/index.js";
import { leaveOutKindsFor, useListingMeeting, type MeetControls } from "../directory/index.js";
import { useListingPosts, useMeetingCard, useProfile, type ProfileModel } from "./people-state.js";
import { ProfileHeader, ProfileTabs } from "./profile-parts.js";

// The words of the profile page (wave 7).
const PROFILE_COPY = {
  title: "Profile",
  loading: "Loading this profile.",
  missing: "This person is no longer in Explore.",
  back: "Back to Explore",
  retry: "Try again",
  addFriend: "Add friend",
  requested: "Requested",
  accept: "Accept",
  decline: "Decline",
  friends: "Friends",
  askAgent: (name: string) => `Ask ${name}'s Meety`,
  meetAgent: (name: string) => `Meet ${name}'s Meety`,
  noCard: "To meet their Meety, open your approved card first.",
  editListing: "Edit my listing",
} as const;

// The quote source line under each public item of this person.
function sourceFor(name: string): string {
  return `${name}, in their own words`;
}

// Meet their Meety: the button that opens today's directory meeting picker for this listing, or the line that a card is needed.
const MeetAgent = (props: { profile: ProfileView; meet: MeetControls | null }): ReactElement => {
  const { profile, meet } = props;
  if (meet === null) return <p className="profile-note">{PROFILE_COPY.noCard}</p>;
  const isOpen = meet.state.openListingId === profile.listingId;
  return (
    <>
      <button type="button" className="quiet" aria-expanded={isOpen} onClick={() => { meet.toggle(profile.listingId); }}>
        {PROFILE_COPY.meetAgent(profile.displayName)}
      </button>
      {isOpen ? (
        <div className="profile-meet">
          <QuestionPicker isSending={meet.state.isSending} error={meet.state.error} leaveOutKinds={leaveOutKindsFor(profile)} onCreate={(pick) => void meet.create(profile.listingId, pick)} />
        </div>
      ) : null}
    </>
  );
};

// The buttons of a friend's profile: the Friends chip, Ask their Meety (or why not), and Meet their Meety.
const FriendButtons = (props: { profile: ProfileView; meet: MeetControls | null }): ReactElement => {
  const { profile } = props;
  return (
    <>
      <span className="chip profile-friends">
        <Icon name="check" size={16} isBold />
        {PROFILE_COPY.friends}
      </span>
      {profile.canAsk ? (
        <Link className="btn" to={chatPathWithDraft(`How would ${profile.displayName} react to `)}>{PROFILE_COPY.askAgent(profile.displayName)}</Link>
      ) : (
        <p className="profile-note">{`${profile.displayName} has not turned on friend asks yet.`}</p>
      )}
      <MeetAgent profile={profile} meet={props.meet} />
    </>
  );
};

// The buttons under the header, by how the viewer stands with this person.
const FriendshipButtons = (props: { model: ProfileModel; profile: ProfileView; meet: MeetControls | null }): ReactElement => {
  const { model, profile } = props;
  const isSending = model.action.kind === "sending";
  const requestId = profile.requestId;
  if (profile.friendship === "self") return <Link className="btn quiet" to={APP_PATHS.me}>{PROFILE_COPY.editListing}</Link>;
  if (profile.friendship === "friends") return <FriendButtons profile={profile} meet={props.meet} />;
  if (profile.friendship === "requested") {
    return (
      <>
        <button type="button" className="quiet" disabled>{PROFILE_COPY.requested}</button>
        <p className="profile-note">{`Waiting for ${profile.displayName} to answer.`}</p>
      </>
    );
  }
  if (profile.friendship === "incoming" && requestId !== null) {
    return (
      <>
        <button type="button" disabled={isSending} onClick={() => void model.accept(requestId)}>{PROFILE_COPY.accept}</button>
        <button type="button" className="quiet" disabled={isSending} onClick={() => void model.decline(requestId)}>{PROFILE_COPY.decline}</button>
      </>
    );
  }
  return <button type="button" disabled={isSending} onClick={() => void model.addFriend()}>{PROFILE_COPY.addFriend}</button>;
};

// A loaded profile: the header with its buttons and any refusal, then the About and Posts tabs, open on Posts when the address says so.
const ProfileBody = (props: { model: ProfileModel; profile: ProfileView }): ReactElement => {
  const { model, profile } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const cardId = useMeetingCard(location.search, profile.friendship === "friends");
  const meet = useListingMeeting({ cardId, go: (path) => { navigate(path); } });
  const posts = useListingPosts(profile.listingId);
  return (
    <>
      <ProfileHeader name={profile.displayName} line={profile.line} isSample={profile.isSample} photo={profile.photo}>
        <FriendshipButtons model={model} profile={profile} meet={cardId === null ? null : meet} />
      </ProfileHeader>
      {model.action.kind === "failed" ? <ErrorNotice error={model.action.error} /> : null}
      <ProfileTabs
        key={profile.listingId}
        items={profile.items}
        source={sourceFor(profile.displayName)}
        postsName={profile.friendship === "self" ? null : profile.displayName}
        posts={posts}
        firstTab={readProfileTab(location.search)}
      />
    </>
  );
};

// The page before a profile has loaded: loading, gone from Explore (404), or another error with a retry.
const ProfileWaiting = (props: { model: ProfileModel }): ReactElement => {
  const { error } = props.model.profile;
  if (error === null) return <LoadingLine text={PROFILE_COPY.loading} />;
  if (error.status === 404) {
    return <EmptyState sticker="poof" title={PROFILE_COPY.missing} action={<Link className="btn" to={APP_PATHS.explore}>{PROFILE_COPY.back}</Link>} />;
  }
  return (
    <>
      <ErrorNotice error={error} />
      <button type="button" className="quiet" onClick={props.model.profile.reload}>{PROFILE_COPY.retry}</button>
    </>
  );
};

// One person's profile from Explore, at /people/:listingId: Instagram's header and tabs, with the buttons of a friend request (wave 7).
export const PersonScreen = (): ReactElement => {
  const { listingId = "" } = useParams();
  const model = useProfile(listingId);
  const profile = model.profile.value;
  return (
    <ScreenFrame title={profile?.displayName ?? PROFILE_COPY.title} hasOwnHeading={profile !== null} isWide>
      <div className="profile-page">{profile === null ? <ProfileWaiting model={model} /> : <ProfileBody model={model} profile={profile} />}</div>
    </ScreenFrame>
  );
};
