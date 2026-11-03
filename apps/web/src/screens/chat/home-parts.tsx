// The home page's Instagram parts around Meety's chat (Ambar's screenshot of 3 Nov 2026): your friends as a row of circles across the
// top, as Instagram shows stories, and on a wide screen a right-hand column with you, your friends and people Explore suggests, as
// Instagram shows "Suggested for you". A ring in Meet First's two colours means that friend's agent can be asked.
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing, Friend, HomeView } from "@meet-first/contracts";
import { APP_PATHS } from "../../app-shell/index.js";
import { Icon, PersonAvatar, SampleChip } from "../../look/index.js";
import type { AddsModel, AddState } from "./chat-state.js";

// The most friends and suggestions the right-hand column lists; See all leads to the rest.
export const SIDE_ROWS_MAX = 5;

// Where a friend links to: their profile when Explore shows them, else the Friends page.
function friendPath(friend: Friend): string {
  return friend.listingId === null ? APP_PATHS.friends : APP_PATHS.person(friend.listingId);
}

// The people Explore suggests: the first page, less your friends, at most SIDE_ROWS_MAX.
export function suggestedPeople(listings: readonly DirectoryListing[], friends: readonly Friend[]): DirectoryListing[] {
  const known = new Set(friends.map((friend) => friend.listingId));
  return listings.filter((listing) => !known.has(listing.listingId)).slice(0, SIDE_ROWS_MAX);
}

// Your friends as circles with their names under them, after a first circle that finds more people in Explore.
export const FriendsRow = (props: { friends: readonly Friend[] }): ReactElement => {
  return (
    <nav className="home-stories" aria-label="Friends">
      <ul>
        <li>
          <Link className="story" to={APP_PATHS.explore}>
            <span className="story-ring is-add">
              <Icon name="add" size={26} />
            </span>
            <span className="story-name">Find people</span>
          </Link>
        </li>
        {props.friends.map((friend) => (
          <li key={friend.pairId}>
            <Link className="story" to={friendPath(friend)}>
              <span className={friend.canAsk ? "story-ring is-on" : "story-ring"}>
                <PersonAvatar name={friend.displayName} size="l" />
              </span>
              <span className="story-name">{friend.displayName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

// The words or the button at the end of a suggestion's row, by where its friend request stands.
const AddControl = (props: { listing: DirectoryListing; state: AddState; onAdd: () => void }): ReactElement => {
  const { state } = props;
  if (state.kind === "requested") return <span className="side-done">Requested</span>;
  if (state.kind === "friends") return <span className="side-done">Friends</span>;
  return (
    <button type="button" className="text-button side-add" disabled={state.kind === "sending"} onClick={props.onAdd} aria-label={`Add ${props.listing.displayName} as a friend`}>
      {state.kind === "sending" ? "Sending" : "Add friend"}
    </button>
  );
};

// The column's heading with its See all link.
const SideHead = (props: { id: string; title: string; to: string; seeAll: string }): ReactElement => {
  return (
    <div className="side-head">
      <h2 id={props.id}>{props.title}</h2>
      <Link to={props.to} aria-label={props.seeAll}>See all</Link>
    </div>
  );
};

// Your friends in the column: each with an Ask button that puts "How would NAME react to " in Meety's box, when their agent can be asked.
const SideFriends = (props: { friends: readonly Friend[]; onAsk: (name: string) => void }): ReactElement => {
  const shown = props.friends.slice(0, SIDE_ROWS_MAX);
  return (
    <section aria-labelledby="side-friends-title">
      <SideHead id="side-friends-title" title="Your friends" to={APP_PATHS.friends} seeAll="See all your friends" />
      {shown.length === 0 ? (
        <p className="side-none">
          No friends yet. <Link to={APP_PATHS.explore}>Find people in Explore</Link>
        </p>
      ) : (
        <ul className="side-list">
          {shown.map((friend) => (
            <li key={friend.pairId} className="side-row">
              <PersonAvatar name={friend.displayName} />
              <span className="side-who">
                <Link className="side-name" to={friendPath(friend)}>{friend.displayName}</Link>
                <small>{friend.canAsk ? "Their Meety can be asked" : "Friend asks are off"}</small>
              </span>
              {friend.canAsk ? (
                <button type="button" className="text-button side-add" onClick={() => { props.onAsk(friend.displayName); }} aria-label={`Ask Meety about ${friend.displayName}`}>
                  Ask
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// People Explore suggests, each with Add friend, which sends a friend request at once, and the Sample mark on a sample person.
const SideSuggestions = (props: { people: readonly DirectoryListing[]; adds: AddsModel }): ReactElement | null => {
  if (props.people.length === 0) return null;
  return (
    <section aria-labelledby="side-suggested-title">
      <SideHead id="side-suggested-title" title="Suggested for you" to={APP_PATHS.explore} seeAll="See everyone in Explore" />
      <ul className="side-list">
        {props.people.map((listing) => {
          const state = props.adds.stateOf(listing.listingId);
          return (
            <li key={listing.listingId} className="side-row">
              <PersonAvatar name={listing.displayName} />
              <span className="side-who">
                <span className="side-name-row">
                  <Link className="side-name" to={APP_PATHS.person(listing.listingId)}>{listing.displayName}</Link>
                  {listing.isSample ? <SampleChip /> : null}
                </span>
                <small>{state.kind === "refused" ? state.sentence : listing.line}</small>
              </span>
              <AddControl listing={listing} state={state} onAdd={() => void props.adds.add(listing)} />
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// The right-hand column: you at the top with a link to your profile, then your friends, then the people Explore suggests.
export const HomeSide = (props: { home: HomeView | null; friends: readonly Friend[] | null; suggestions: readonly DirectoryListing[] | null; adds: AddsModel; onAsk: (name: string) => void }): ReactElement => {
  const friends = props.friends ?? [];
  return (
    <aside className="home-side" aria-label="You, your friends and people to meet">
      {props.home === null ? null : (
        <div className="side-row side-me">
          <PersonAvatar name={props.home.displayName} />
          <span className="side-who">
            <Link className="side-name" to={APP_PATHS.me}>{props.home.displayName}</Link>
            <small>Your profile</small>
          </span>
          <Link className="side-link" to={APP_PATHS.me} aria-label="Open your profile">Open</Link>
        </div>
      )}
      {props.friends === null ? null : <SideFriends friends={friends} onAsk={props.onAsk} />}
      {props.suggestions === null ? null : <SideSuggestions people={suggestedPeople(props.suggestions, friends)} adds={props.adds} />}
      <p className="side-foot">Meet First. Your Meety meets theirs first.</p>
    </aside>
  );
};
