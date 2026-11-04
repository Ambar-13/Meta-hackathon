// The parts of people the feed (Home) and Search show: Add friend and where a request stands, a
// person as a card and as a row, and the photos as Instagram's Explore grid.
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing, Post } from "@meet-first/contracts";
import { APP_PATHS, personPostsPath } from "../../app-shell/index.js";
import { PersonAvatar, photoOf, SampleChip } from "../../look/index.js";
import type { AddState } from "../chat/index.js";
import type { ExploreFriends } from "./explore-state.js";

// The line under a person's name: their own line, or in its place the sentence of a friend request
// the server refused.
export function lineFor(line: string, state: AddState): string {
  return state.kind === "refused" ? state.sentence : line;
}

// Add friend for one person, or where their request stands: blue words in a post or a row, a blue
// button on a card. A post by someone who was already a friend shows nothing, as a feed shows no
// Follow on the people you follow; someone added from this page shows Friends.
export const FriendControl = (props: {
  listing: DirectoryListing;
  friends: ExploreFriends;
  look: "post" | "row" | "card";
}): ReactElement | null => {
  const { listing, friends } = props;
  const state = friends.adds.stateOf(listing.listingId);
  if (state.kind === "friends") return <span className="friend-state">Friends</span>;
  if (friends.isFriend(listing.listingId))
    return props.look === "post" ? null : <span className="friend-state">Friends</span>;
  if (state.kind === "requested") return <span className="friend-state">Requested</span>;
  return (
    <button
      type="button"
      className={props.look === "card" ? "friend-add" : "text-button friend-add"}
      disabled={state.kind === "sending"}
      onClick={() => void friends.adds.add(listing)}
      aria-label={`Add ${listing.displayName} as a friend`}
    >
      {state.kind === "sending" ? "Sending" : "Add friend"}
    </button>
  );
};

// One person Explore suggests, as a card in Instagram's "Suggested for you" row: their picture,
// name, Sample mark and line, as one link to their profile, with the Add friend button under it.
// Whether they are open to dating questions is never shown.
export const PersonCard = (props: {
  listing: DirectoryListing;
  friends: ExploreFriends;
}): ReactElement => {
  const { listing, friends } = props;
  return (
    <li className="person-card">
      <Link className="person-card-link" to={APP_PATHS.person(listing.listingId)}>
        <PersonAvatar
          name={listing.displayName}
          size="l"
          photo={listing.photo}
          isSample={listing.isSample}
        />
        <h3 className="person-card-name">{listing.displayName}</h3>
        {listing.isSample ? <SampleChip /> : null}
        <p className="person-card-line">
          {lineFor(listing.line, friends.adds.stateOf(listing.listingId))}
        </p>
      </Link>
      <FriendControl listing={listing} friends={friends} look="card" />
    </li>
  );
};

// One person in a list: their picture, name, Sample mark, line and first public item's claim, as one
// link to their profile, with Add friend at the end of the row.
export const PersonRow = (props: {
  listing: DirectoryListing;
  friends: ExploreFriends;
}): ReactElement => {
  const { listing, friends } = props;
  const first = listing.items[0];
  return (
    <li className="person-row">
      <Link className="person-row-link" to={APP_PATHS.person(listing.listingId)}>
        <PersonAvatar
          name={listing.displayName}
          photo={listing.photo}
          isSample={listing.isSample}
        />
        <div className="person-row-words">
          <div className="person-row-name">
            <h3>{listing.displayName}</h3>
            {listing.isSample ? <SampleChip /> : null}
          </div>
          <p className="person-row-line">
            {lineFor(listing.line, friends.adds.stateOf(listing.listingId))}
          </p>
          {first === undefined ? null : <p className="person-row-claim">{first.claim}</p>}
        </div>
      </Link>
      <FriendControl listing={listing} friends={friends} look="row" />
    </li>
  );
};

// The photos as Instagram's Explore grid: every photo post of someone else as a tall tile with
// square corners, three to a row, newest first, each opening its writer's Posts tab. On a laptop
// the writer's face and name show over the tile on hover. Nothing shows without photos.
export const PhotoGrid = (props: { posts: readonly Post[] }): ReactElement | null => {
  const photos = props.posts.filter((post) => post.isMine !== true && photoOf(post.photo) !== null);
  if (photos.length === 0) return null;
  return (
    <ul className="photo-grid">
      {photos.map((post) => (
        <li key={post.postId}>
          <Link
            className="photo-cell"
            to={personPostsPath(post.listingId)}
            aria-label={`${post.displayName}'s posts: ${post.photoAlt ?? (post.text === "" ? "a photo" : post.text)}`}
          >
            <img src={photoOf(post.photo)?.src} alt="" loading="lazy" decoding="async" />
            <span className="photo-cell-who" aria-hidden="true">
              <PersonAvatar
                name={post.displayName}
                size="s"
                photo={post.authorPhoto}
                isSample={post.isSample}
              />
              <b>{post.displayName}</b>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
};
