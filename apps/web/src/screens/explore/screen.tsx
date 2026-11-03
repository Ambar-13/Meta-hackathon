import "./explore.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing, Post, PostsView } from "@meet-first/contracts";
import { APP_PATHS, chatPathWithDraft, ErrorNotice, personPostsPath, ScreenFrame, type PolledView } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, PersonAvatar, SampleChip } from "../../look/index.js";
import type { AddState } from "../chat/index.js";
import { SEARCH_MAX_CHARS, useDirectoryBrowse, type BrowseHook } from "../directory/index.js";
import { postAgeWords } from "../people/index.js";
import { peopleRowAt, useExploreFriends, useExplorePosts, type ExploreFriends } from "./explore-state.js";

// The words of the Explore page (wave 7; a feed since 3 Nov 2026).
const EXPLORE_COPY = {
  title: "Explore",
  searchLabel: "Search Explore",
  search: "Search",
  stuck: "Stuck on something?",
  askOrchestrator: "Ask Meety who could help.",
  loading: "Loading people.",
  loadingPosts: "Loading posts.",
  emptyTitle: "Nobody matches yet",
  emptyLine: "Try other words, or clear the search.",
  more: "Show more",
  retry: "Try again",
  postsFailed: "Posts did not load.",
  feedLabel: "Posts in Explore",
  suggestedTitle: "Suggested for you",
  seeAll: "See all",
  everyoneTitle: "Everyone in Explore",
  resultsTitle: "People",
  backToPosts: "Back to posts",
} as const;
// The words a listing open to dating questions shows, as the directory showed them (design section 11).
const OPEN_TO_ROMANCE_COPY = "Open to dating questions";

// A listing for the Add friend button of a post whose writer is not on the loaded pages of Explore.
function listingOfPost(post: Post): DirectoryListing {
  return { listingId: post.listingId, displayName: post.displayName, line: "", openToRomance: false, isSample: post.isSample, items: [] };
}

// The line under a person's name: their own line, or in its place the sentence of a friend request the server refused.
function lineFor(line: string, state: AddState): string {
  return state.kind === "refused" ? state.sentence : line;
}

// The search box: the words go to Explore from page 0, and an empty search goes back to the feed (design section 6).
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
        <input type="text" placeholder="Search by what people do" maxLength={SEARCH_MAX_CHARS} value={text} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="submit" className="quiet">{EXPLORE_COPY.search}</button>
    </form>
  );
};

// Add friend for one person, or where their request stands: blue words in a post or a row, a blue button on a card. A post by someone
// who was already a friend shows nothing, as a feed shows no Follow on the people you follow; someone added from this page shows Friends.
const FriendControl = (props: { listing: DirectoryListing; friends: ExploreFriends; look: "post" | "row" | "card" }): ReactElement | null => {
  const { listing, friends } = props;
  const state = friends.adds.stateOf(listing.listingId);
  if (state.kind === "friends") return <span className="friend-state">Friends</span>;
  if (friends.isFriend(listing.listingId)) return props.look === "post" ? null : <span className="friend-state">Friends</span>;
  if (state.kind === "requested") return <span className="friend-state">Requested</span>;
  return (
    <button type="button" className={props.look === "card" ? "friend-add" : "text-button friend-add"} disabled={state.kind === "sending"}
      onClick={() => void friends.adds.add(listing)} aria-label={`Add ${listing.displayName} as a friend`}>
      {state.kind === "sending" ? "Sending" : "Add friend"}
    </button>
  );
};

// One post in the feed, as a post in Threads or LinkedIn: the writer's picture in the left column; on the right their name, the Sample
// mark, the post's age and their line, with Add friend at the end; the post under them; then Ask Meety (about them) when their agent
// can be asked, and More from them, which opens their Posts tab. The two fit one line on a phone.
const FeedPost = (props: { post: Post; listing: DirectoryListing | undefined; friends: ExploreFriends }): ReactElement => {
  const { post, friends } = props;
  const listing = props.listing ?? listingOfPost(post);
  const profile = APP_PATHS.person(post.listingId);
  const line = lineFor(listing.line, friends.adds.stateOf(post.listingId));
  return (
    <article className="feed-post" aria-label={`${post.displayName}'s post`}>
      <Link className="feed-avatar" to={profile} tabIndex={-1} aria-hidden="true">
        <PersonAvatar name={post.displayName} />
      </Link>
      <header className="feed-head">
        <div className="feed-who">
          <p className="feed-name-row">
            <Link className="feed-name" to={profile}>{post.displayName}</Link>
            {post.isSample ? <SampleChip /> : null}
            <time className="feed-time" dateTime={post.createdAt}>{postAgeWords(post.createdAt, new Date())}</time>
          </p>
          {line === "" ? null : <p className="feed-line">{line}</p>}
        </div>
        <FriendControl listing={listing} friends={friends} look="post" />
      </header>
      <p className="feed-text">{post.text}</p>
      <footer className="feed-actions">
        {friends.canAsk(post.listingId) ? (
          <Link className="feed-action" to={chatPathWithDraft(`How would ${post.displayName} react to `)} aria-label={`Ask Meety about ${post.displayName}`}>
            <Icon name="meety" size={18} />
            Ask Meety
          </Link>
        ) : null}
        <Link className="feed-action" to={personPostsPath(post.listingId)}>
          <Icon name="posts" size={18} />
          {`More from ${post.displayName}`}
        </Link>
      </footer>
    </article>
  );
};

// One person Explore suggests, as a card in Instagram's "Suggested for you" row: their picture, name, Sample mark, line, and the dating
// words when open, as one link to their profile, with the Add friend button under it.
const PersonCard = (props: { listing: DirectoryListing; friends: ExploreFriends }): ReactElement => {
  const { listing, friends } = props;
  return (
    <li className="person-card">
      <Link className="person-card-link" to={APP_PATHS.person(listing.listingId)}>
        <PersonAvatar name={listing.displayName} size="l" />
        <h3 className="person-card-name">{listing.displayName}</h3>
        {listing.isSample ? <SampleChip /> : null}
        <p className="person-card-line">{lineFor(listing.line, friends.adds.stateOf(listing.listingId))}</p>
        {listing.openToRomance ? <span className="listing-open">{OPEN_TO_ROMANCE_COPY}</span> : null}
      </Link>
      <FriendControl listing={listing} friends={friends} look="card" />
    </li>
  );
};

// The row of people Explore suggests, inside the feed: cards that scroll sideways, See all at the top, and Show more at the end while
// more pages exist.
const SuggestedRow = (props: { browse: BrowseHook; friends: ExploreFriends; onSeeAll: () => void }): ReactElement => {
  const { browse, friends } = props;
  return (
    <section className="suggested" aria-labelledby="suggested-title">
      <div className="explore-head">
        <h2 id="suggested-title">{EXPLORE_COPY.suggestedTitle}</h2>
        <button type="button" className="text-button" onClick={props.onSeeAll}>{EXPLORE_COPY.seeAll}</button>
      </div>
      <ul className="person-cards">
        {browse.listings.map((listing) => <PersonCard key={listing.listingId} listing={listing} friends={friends} />)}
        {browse.hasMore ? (
          <li className="person-card is-more">
            <button type="button" className="quiet" disabled={browse.isLoading} onClick={browse.loadMore}>{EXPLORE_COPY.more}</button>
          </li>
        ) : null}
      </ul>
    </section>
  );
};

// One person in a list: their picture, name, Sample mark, line, first public item's claim, and the dating words when open, as one link
// to their profile, with Add friend at the end of the row.
const PersonRow = (props: { listing: DirectoryListing; friends: ExploreFriends }): ReactElement => {
  const { listing, friends } = props;
  const first = listing.items[0];
  return (
    <li className="person-row">
      <Link className="person-row-link" to={APP_PATHS.person(listing.listingId)}>
        <PersonAvatar name={listing.displayName} />
        <div className="person-row-words">
          <div className="person-row-name">
            <h3>{listing.displayName}</h3>
            {listing.isSample ? <SampleChip /> : null}
          </div>
          <p className="person-row-line">{lineFor(listing.line, friends.adds.stateOf(listing.listingId))}</p>
          {first === undefined ? null : <p className="person-row-claim">{first.claim}</p>}
          {listing.openToRomance ? <span className="listing-open">{OPEN_TO_ROMANCE_COPY}</span> : null}
        </div>
      </Link>
      <FriendControl listing={listing} friends={friends} look="row" />
    </li>
  );
};

// The people a search found, or everyone in Explore after See all, as rows, with Show more while more pages exist; onBack, when
// given, is Back to posts.
const PeopleList = (props: { browse: BrowseHook; friends: ExploreFriends; onBack: (() => void) | null }): ReactElement => {
  const { browse, onBack } = props;
  return (
    <section className="people-list" aria-labelledby="people-list-title">
      <div className="explore-head">
        <h2 id="people-list-title">{onBack === null ? EXPLORE_COPY.resultsTitle : EXPLORE_COPY.everyoneTitle}</h2>
        {onBack === null ? null : <button type="button" className="text-button" onClick={onBack}>{EXPLORE_COPY.backToPosts}</button>}
      </div>
      <ul className="person-rows">
        {browse.listings.map((listing) => <PersonRow key={listing.listingId} listing={listing} friends={props.friends} />)}
      </ul>
      {browse.hasMore ? (
        <button type="button" className="quiet explore-more" disabled={browse.isLoading} onClick={browse.loadMore}>{EXPLORE_COPY.more}</button>
      ) : null}
    </section>
  );
};

// The line under the feed when the posts did not load, with Try again.
const PostsFailed = (props: { posts: PolledView<PostsView> }): ReactElement | null => {
  if (props.posts.error === null) return null;
  return (
    <p className="explore-posts-failed">
      {`${EXPLORE_COPY.postsFailed} `}
      <button type="button" className="text-button" onClick={props.posts.reload}>{EXPLORE_COPY.retry}</button>
    </p>
  );
};

// The feed: the newest posts, with the row of suggested people after the second; each post's line comes from the loaded people.
const Feed = (props: { browse: BrowseHook; posts: PolledView<PostsView>; friends: ExploreFriends; onSeeAll: () => void }): ReactElement => {
  const { browse, posts, friends } = props;
  const list = posts.value?.posts ?? [];
  const at = peopleRowAt(list.length);
  const byListing = new Map(browse.listings.map((listing) => [listing.listingId, listing]));
  const postItem = (post: Post): ReactElement => (
    <li key={post.postId}>
      <FeedPost post={post} listing={byListing.get(post.listingId)} friends={friends} />
    </li>
  );
  return (
    <section className="feed" aria-label={EXPLORE_COPY.feedLabel}>
      <ul className="feed-list">
        {list.slice(0, at).map(postItem)}
        {browse.listings.length === 0 ? null : (
          <li className="feed-suggested">
            <SuggestedRow browse={browse} friends={friends} onSeeAll={props.onSeeAll} />
          </li>
        )}
        {list.slice(at).map(postItem)}
      </ul>
      {posts.value === null && posts.error === null ? <LoadingLine text={EXPLORE_COPY.loadingPosts} /> : null}
      <PostsFailed posts={posts} />
    </section>
  );
};

// The states above the content: an error with Try again, loading, and nobody found.
const ExploreStatus = (props: { browse: BrowseHook; isEmpty: boolean }): ReactElement => {
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

// True when the page has nothing to show: nobody in Explore or the search, and, in the feed, no posts once they have loaded or failed.
function isNothingShown(browse: BrowseHook, posts: PolledView<PostsView>, isPeople: boolean): boolean {
  const isNobody = browse.hasLoaded && !browse.isLoading && browse.error === null && browse.listings.length === 0;
  if (!isNobody || isPeople) return isNobody;
  return posts.value === null ? posts.error !== null : posts.value.posts.length === 0;
}

// The /explore page as a feed (Ambar, 3 Nov 2026: "it should have been looking like linkedin or instagram feed"): the search box and a
// way to ask Meety for help, then the posts with the people Explore suggests, or the people a search found, or everyone after See all.
export const ExploreScreen = (): ReactElement => {
  const browse = useDirectoryBrowse();
  const posts = useExplorePosts();
  const friends = useExploreFriends();
  const [isEveryone, setIsEveryone] = useState(false);
  const isSearching = browse.query !== "";
  const isPeople = isSearching || isEveryone;
  const search = (query: string): void => {
    setIsEveryone(false);
    browse.search(query);
  };
  const people = browse.listings.length === 0 ? null : (
    <PeopleList browse={browse} friends={friends} onBack={isSearching ? null : () => { setIsEveryone(false); }} />
  );
  return (
    <ScreenFrame title={EXPLORE_COPY.title} isWide>
      <div className="explore">
        <SearchForm onSearch={search} />
        <p className="explore-stuck">
          {`${EXPLORE_COPY.stuck} `}
          <Link to={APP_PATHS.home}>{EXPLORE_COPY.askOrchestrator}</Link>
        </p>
        <ExploreStatus browse={browse} isEmpty={isNothingShown(browse, posts, isPeople)} />
        {isPeople ? people : <Feed browse={browse} posts={posts} friends={friends} onSeeAll={() => { setIsEveryone(true); }} />}
      </div>
    </ScreenFrame>
  );
};
