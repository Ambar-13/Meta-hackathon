import "./explore.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing, Post, PostsView } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, personPostsPath, ScreenFrame, type PolledView } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, PersonAvatar, SampleChip, tintOf } from "../../look/index.js";
import { SEARCH_MAX_CHARS, useDirectoryBrowse, type BrowseHook } from "../directory/index.js";
import { postAgeWords } from "../people/index.js";
import { mixTiles, useExplorePosts } from "./explore-state.js";

// The words of the Explore page (wave 7).
const EXPLORE_COPY = {
  title: "Explore",
  searchLabel: "Search Explore",
  search: "Search",
  stuck: "Stuck on something?",
  askOrchestrator: "Ask Meety who could help.",
  loading: "Loading people.",
  emptyTitle: "Nobody matches yet",
  emptyLine: "Try other words, or clear the search.",
  more: "Show more",
  retry: "Try again",
  gridLabel: "People and posts in Explore",
  postsFailed: "Posts did not load.",
} as const;
// The words a listing open to dating questions shows, as the directory showed them (design section 11).
const OPEN_TO_ROMANCE_COPY = "Open to dating questions";

// The search box: the words go to Explore from page 0, and an empty search lists everyone, newest first (design section 6).
const SearchForm = (props: { onSearch: (query: string) => void }): ReactElement => {
  const [text, setText] = useState("");
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSearch(text);
  };
  return (
    <form role="search" className="explore-search" onSubmit={onSubmit}>
      <label className="explore-field">
        <span className="explore-label">{EXPLORE_COPY.searchLabel}</span>
        <Icon name="search" size={18} className="explore-glass" />
        <input type="text" placeholder="Search people by what they do" maxLength={SEARCH_MAX_CHARS} value={text} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="submit" className="quiet">{EXPLORE_COPY.search}</button>
    </form>
  );
};

// One person as a tile, like a post in Instagram's Explore: their line on their own colour, then their picture and name with the
// Sample mark when they are one, their first public item's claim, and the dating words when open. The whole tile is one link to their
// profile.
const PersonTile = (props: { listing: DirectoryListing; isAlone: boolean }): ReactElement => {
  const { listing } = props;
  const first = listing.items[0];
  return (
    <li className={props.isAlone ? "is-alone" : undefined}>
      <Link className={`explore-tile ${tintOf(listing.displayName)}`} to={APP_PATHS.person(listing.listingId)}>
        <p className="tile-line">{listing.line}</p>
        <span className="tile-foot">
          <span className="tile-who">
            <PersonAvatar name={listing.displayName} size="s" />
            <h2 className="tile-name">{listing.displayName}</h2>
            {listing.isSample ? <SampleChip /> : null}
          </span>
          {first === undefined ? null : <span className="tile-claim">{first.claim}</span>}
          {listing.openToRomance ? <span className="listing-open">{OPEN_TO_ROMANCE_COPY}</span> : null}
        </span>
      </Link>
    </li>
  );
};

// One post as a tile, on white beside the coloured people: who wrote it, the post, and how long ago. The whole tile is one link to
// its person's profile, open on their Posts tab.
const PostTile = (props: { post: Post; now: Date }): ReactElement => {
  const { post } = props;
  return (
    <li className="is-post">
      <Link className="explore-tile post-tile" to={personPostsPath(post.listingId)}>
        <span className="tile-who">
          <PersonAvatar name={post.displayName} size="s" />
          <span className="tile-name">{post.displayName}</span>
          {post.isSample ? <SampleChip /> : null}
        </span>
        <p className="post-text">{post.text}</p>
        <time className="post-time" dateTime={post.createdAt}>{postAgeWords(post.createdAt, props.now)}</time>
      </Link>
    </li>
  );
};

// The posts the grid mixes in: none during a search, which finds people only, and none until they load.
function postsToMix(browse: BrowseHook, posts: PolledView<PostsView>): Post[] {
  return browse.query === "" ? posts.value?.posts ?? [] : [];
}

// The grid's states above the tiles: an error with a retry, loading, and nobody found.
const GridStatus = (props: { browse: BrowseHook; isEmpty: boolean }): ReactElement => {
  const { browse } = props;
  return (
    <>
      {browse.error === null ? null : (
        <div className="explore-error">
          <ErrorNotice error={browse.error} />
          <button type="button" className="quiet" onClick={() => { browse.search(browse.query); }}>{EXPLORE_COPY.retry}</button>
        </div>
      )}
      {browse.isLoading && !browse.hasLoaded ? <LoadingLine text={EXPLORE_COPY.loading} /> : null}
      {props.isEmpty ? <EmptyState sticker="lens" title={EXPLORE_COPY.emptyTitle}>{EXPLORE_COPY.emptyLine}</EmptyState> : null}
    </>
  );
};

// The line under the tiles when the posts did not load, with Try again; nothing during a search, which shows no posts.
const PostsFailed = (props: { browse: BrowseHook; posts: PolledView<PostsView> }): ReactElement | null => {
  if (props.posts.error === null || props.browse.query !== "") return null;
  return (
    <p className="explore-posts-failed">
      {`${EXPLORE_COPY.postsFailed} `}
      <button type="button" className="text-button" onClick={props.posts.reload}>{EXPLORE_COPY.retry}</button>
    </p>
  );
};

// The grid with its states, people and posts mixed, the posts line, and Show more while more pages of people exist.
const ExploreGrid = (props: { browse: BrowseHook; posts: PolledView<PostsView> }): ReactElement => {
  const { browse, posts } = props;
  const shownPosts = postsToMix(browse, posts);
  const isEmpty = browse.hasLoaded && !browse.isLoading && browse.error === null && browse.listings.length === 0 && shownPosts.length === 0;
  const now = new Date();
  return (
    <section className="explore-people" aria-label={EXPLORE_COPY.gridLabel}>
      <GridStatus browse={browse} isEmpty={isEmpty} />
      <ul className="explore-grid">
        {mixTiles(browse.listings, shownPosts).map((tile) => (tile.kind === "person" ? <PersonTile key={tile.listing.listingId} listing={tile.listing} isAlone={tile.isAlone} /> : <PostTile key={tile.post.postId} post={tile.post} now={now} />))}
      </ul>
      <PostsFailed browse={browse} posts={posts} />
      {browse.hasMore ? (
        <button type="button" className="quiet explore-more" disabled={browse.isLoading} onClick={browse.loadMore}>
          {EXPLORE_COPY.more}
        </button>
      ) : null}
    </section>
  );
};

// The /explore page: the search box, a way to ask Meety for help, and everyone in Explore with their posts as one grid of tiles
// (wave 7; posts since 3 Nov 2026).
export const ExploreScreen = (): ReactElement => {
  const browse = useDirectoryBrowse();
  const posts = useExplorePosts();
  return (
    <ScreenFrame title={EXPLORE_COPY.title} isWide>
      <SearchForm onSearch={browse.search} />
      <p className="explore-stuck">
        {`${EXPLORE_COPY.stuck} `}
        <Link to={APP_PATHS.home}>{EXPLORE_COPY.askOrchestrator}</Link>
      </p>
      <ExploreGrid browse={browse} posts={posts} />
    </ScreenFrame>
  );
};
