import "./explore.css";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing, Post, PostsView, PublicItem } from "@meet-first/contracts";
import { APP_PATHS, chatPathWithDraft, ErrorNotice, personPostsPath, ScreenFrame, type PolledView } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, MeetyMark, PersonAvatar, photoOf, PostPhoto, SampleChip } from "../../look/index.js";
import type { AddState } from "../chat/index.js";
import { SEARCH_MAX_CHARS, useDirectoryBrowse, type BrowseHook } from "../directory/index.js";
import { postAgeWords } from "../people/index.js";
import { noteItemFor, peopleRowAt, storyPeople, useExploreFriends, useExplorePosts, type ExploreFriends } from "./explore-state.js";

// The words of the Explore page (wave 7; a feed since 3 Nov 2026, in the look of the "Other" concept and Instagram the same day).
const EXPLORE_COPY = {
  title: "Explore",
  eyebrow: "People, not just posts.",
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
  storiesLabel: "People in Explore",
  yourMeety: "Your Meety",
  tabsLabel: "Posts to show",
  feedLabel: "Posts in Explore",
  friendsEmpty: "No posts from your friends yet. Add a friend from For you, and their posts show here.",
  photosEmpty: "No photos yet.",
  sample: "Sample person",
  suggestedTitle: "Suggested for you",
  seeAll: "See all",
  everyoneTitle: "Everyone in Explore",
  resultsTitle: "People",
  backToPosts: "Back to posts",
  railLabel: "Your Meety and people you might click with",
  meetyLabel: "Meet your Meety",
  meetyTitle: "You're more than your posts.",
  meetyLine: "Your Meety answers your friends' questions from what you chose to share, and every answer shows your own words.",
  meetyLink: "See what it shares",
  clickTitle: "People you might click with",
  seeEveryone: "See everyone",
} as const;
// The words a listing open to dating questions shows, as the directory showed them (design section 11).
const OPEN_TO_ROMANCE_COPY = "Open to dating questions";
// How many people the right-hand column suggests.
const RAIL_PEOPLE_MAX = 4;
// A post of words longer than this shows in the smaller type of its card.
const LONG_POST_CHARS = 160;
// The three views of the feed, after the "Other" concept's tabs: every post, your friends' posts, and the photos as Instagram's grid.
const FEED_TABS = [
  { key: "all", label: "For you" },
  { key: "friends", label: "Friends" },
  { key: "photos", label: "Photos" },
] as const;
// One view of the feed.
type FeedTab = (typeof FEED_TABS)[number]["key"];

// A listing for the Add friend button of a post whose writer is not on the loaded pages of Explore.
function listingOfPost(post: Post): DirectoryListing {
  return { listingId: post.listingId, displayName: post.displayName, line: "", openToRomance: false, isSample: post.isSample, items: [], photo: post.authorPhoto ?? null };
}

// The line under a person's name: their own line, or in its place the sentence of a friend request the server refused.
function lineFor(line: string, state: AddState): string {
  return state.kind === "refused" ? state.sentence : line;
}

// Why Ask NAME's Meety cannot ask yet, said under the post: not friends, a request waiting, or friend asks off.
function askWhyNot(name: string, listingId: string, friends: ExploreFriends): string {
  if (friends.isFriend(listingId)) return `${name} has not turned on friend asks yet.`;
  if (friends.adds.stateOf(listingId).kind === "requested") return `${name}'s Meety can answer once ${name} accepts your request.`;
  return `${name}'s Meety answers questions from ${name}'s friends. Add ${name} as a friend first.`;
}

// Today as the "Other" concept dates its feed. Example: "Tuesday, November 3".
function todayWords(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
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
        <span className="hidden-words">{EXPLORE_COPY.searchLabel}</span>
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

// The row of round faces under the title, as Instagram's stories and the "Other" concept's people: Your Meety first, which opens what
// your Meety shares, then the people on the loaded pages of Explore, friends first, each opening their profile.
const StoriesRow = (props: { browse: BrowseHook; friends: ExploreFriends }): ReactElement => {
  const people = storyPeople(props.browse.listings, props.friends.isFriend);
  return (
    <section className="stories" aria-label={EXPLORE_COPY.storiesLabel}>
      <ul>
        <li>
          <Link className="story is-you" to={APP_PATHS.me}>
            <span className="story-ring">
              <MeetyMark size="l" />
              <span className="story-plus" aria-hidden="true"><Icon name="plus" size={14} isBold /></span>
            </span>
            <span className="story-name">{EXPLORE_COPY.yourMeety}</span>
          </Link>
        </li>
        {people.map((listing) => (
          <li key={listing.listingId}>
            <Link className="story" to={APP_PATHS.person(listing.listingId)}>
              <span className="story-ring">
                <PersonAvatar name={listing.displayName} size="l" photo={listing.photo} isSample={listing.isSample} />
              </span>
              <span className="story-name">{listing.displayName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

// The tabs over the feed, with the arrow keys moving between them as the profile's tabs do.
const FeedTabs = (props: { selected: FeedTab; onSelect: (tab: FeedTab) => void; baseId: string }): ReactElement => {
  const tabRefs = useRef<Partial<Record<FeedTab, HTMLButtonElement | null>>>({});
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = FEED_TABS.findIndex((tab) => tab.key === props.selected);
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: FEED_TABS.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = FEED_TABS[(index + step + FEED_TABS.length) % FEED_TABS.length];
    if (next === undefined) return;
    props.onSelect(next.key);
    tabRefs.current[next.key]?.focus();
  };
  return (
    <div className="feed-tabs" role="tablist" aria-label={EXPLORE_COPY.tabsLabel} onKeyDown={onKeyDown}>
      {FEED_TABS.map((tab) => {
        const isSelected = tab.key === props.selected;
        return (
          <button key={tab.key} ref={(element) => { tabRefs.current[tab.key] = element; }} type="button" role="tab" className="feed-tab"
            id={`${props.baseId}-${tab.key}`} aria-selected={isSelected} aria-controls={`${props.baseId}-panel`} tabIndex={isSelected ? 0 : -1}
            onClick={() => { props.onSelect(tab.key); }}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

// The strip under a post that ties it to what its writer shared: their own words from the public item that shares the most words with
// the post, one link to their profile. Nothing shows when no item shares a word.
const FeedNote = (props: { post: Post; item: PublicItem }): ReactElement => {
  const { post, item } = props;
  return (
    <Link className="feed-note" to={APP_PATHS.person(post.listingId)}>
      <MeetyMark />
      <span className="feed-note-words">
        <b>{`From what ${post.displayName} shared`}</b>
        <q>{item.quote}</q>
      </span>
      <Icon name="arrow" size={18} className="feed-note-go" />
    </Link>
  );
};

// One post, after the "Other" concept and Instagram: a header with the writer's picture (a sample person's face with the orange mark),
// their name, the post's age and their line, with Add friend at the end; then the post, its words over its photo, or, with no photo, its
// words large on a warm card; the strip tying it to what they shared; and Ask NAME's Meety, which opens the chat with a friend ask when
// it can, and else says why under the post, and Posts, their Posts tab.
const FeedPost = (props: { post: Post; listing: DirectoryListing | undefined; friends: ExploreFriends }): ReactElement => {
  const { post, friends } = props;
  const [isWhyOpen, setIsWhyOpen] = useState(false);
  const listing = props.listing ?? listingOfPost(post);
  const profile = APP_PATHS.person(post.listingId);
  const line = lineFor(listing.line, friends.adds.stateOf(post.listingId));
  const item = noteItemFor(post, props.listing);
  const hasPhoto = photoOf(post.photo) !== null;
  const askLabel = `Ask ${post.displayName}'s Meety`;
  return (
    <article className="feed-post" aria-label={`${post.displayName}'s post`}>
      <header className="feed-head">
        <Link className="feed-avatar" to={profile} tabIndex={-1} aria-hidden="true">
          <PersonAvatar name={post.displayName} photo={post.authorPhoto} isSample={post.isSample} />
        </Link>
        <div className="feed-who">
          <p className="feed-name-row">
            <Link className="feed-name" to={profile}>{post.displayName}</Link>
            {post.isSample ? <span className="hidden-words">{EXPLORE_COPY.sample}</span> : null}
            <time className="feed-time" dateTime={post.createdAt}>{postAgeWords(post.createdAt, new Date())}</time>
          </p>
          {line === "" ? null : <p className="feed-line">{line}</p>}
        </div>
        <FriendControl listing={listing} friends={friends} look="post" />
      </header>
      {hasPhoto ? (
        <>
          <p className="feed-text">{post.text}</p>
          <PostPhoto photo={post.photo} alt={post.photoAlt} className="feed-photo" />
        </>
      ) : (
        <blockquote className={post.text.length > LONG_POST_CHARS ? "feed-quote is-long" : "feed-quote"}>
          <p>{post.text}</p>
        </blockquote>
      )}
      {item === null ? null : <FeedNote post={post} item={item} />}
      <footer className="feed-actions">
        {friends.canAsk(post.listingId) ? (
          <Link className="feed-action is-ask" to={chatPathWithDraft(`How would ${post.displayName} react to `)}>
            <Icon name="meety" size={20} />
            {askLabel}
          </Link>
        ) : (
          <button type="button" className="feed-action is-ask" aria-expanded={isWhyOpen} onClick={() => { setIsWhyOpen(!isWhyOpen); }}>
            <Icon name="meety" size={20} />
            {askLabel}
          </button>
        )}
        <Link className="feed-action" to={personPostsPath(post.listingId)} aria-label={`${post.displayName}'s posts`}>
          <Icon name="posts" size={20} />
          Posts
        </Link>
        {isWhyOpen && !friends.canAsk(post.listingId) ? <p className="feed-why" role="status">{askWhyNot(post.displayName, post.listingId, friends)}</p> : null}
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
        <PersonAvatar name={listing.displayName} size="l" photo={listing.photo} isSample={listing.isSample} />
        <h3 className="person-card-name">{listing.displayName}</h3>
        {listing.isSample ? <SampleChip /> : null}
        <p className="person-card-line">{lineFor(listing.line, friends.adds.stateOf(listing.listingId))}</p>
        {listing.openToRomance ? <span className="listing-open">{OPEN_TO_ROMANCE_COPY}</span> : null}
      </Link>
      <FriendControl listing={listing} friends={friends} look="card" />
    </li>
  );
};

// The row of people Explore suggests, inside the feed on a phone and a tablet (the laptop has the right-hand column instead): cards that
// scroll sideways, See all at the top, and Show more at the end while more pages exist.
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
        <PersonAvatar name={listing.displayName} photo={listing.photo} isSample={listing.isSample} />
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

// The posts of For you or Friends, with the row of suggested people after the second post of For you; each post's line comes from the
// loaded people. Friends with no posts yet says how to get some.
const Feed = (props: { browse: BrowseHook; posts: readonly Post[]; friends: ExploreFriends; onSeeAll: () => void; isFriendsOnly: boolean }): ReactElement => {
  const { browse, friends } = props;
  const list = props.isFriendsOnly ? props.posts.filter((post) => friends.isFriend(post.listingId)) : props.posts;
  const at = props.isFriendsOnly ? list.length : peopleRowAt(list.length);
  const byListing = new Map(browse.listings.map((listing) => [listing.listingId, listing]));
  const postItem = (post: Post): ReactElement => (
    <li key={post.postId}>
      <FeedPost post={post} listing={byListing.get(post.listingId)} friends={friends} />
    </li>
  );
  if (props.isFriendsOnly && list.length === 0) return <p className="feed-empty">{EXPLORE_COPY.friendsEmpty}</p>;
  return (
    <ul className="feed-list">
      {list.slice(0, at).map(postItem)}
      {props.isFriendsOnly || browse.listings.length === 0 ? null : (
        <li className="feed-suggested">
          <SuggestedRow browse={browse} friends={friends} onSeeAll={props.onSeeAll} />
        </li>
      )}
      {list.slice(at).map(postItem)}
    </ul>
  );
};

// The Photos tab, as Instagram's Explore grid: every photo post as a tall tile with square corners, three to a row, newest first, each
// opening its writer's Posts tab. On a laptop the writer's face and name show over the tile on hover.
const PhotoGrid = (props: { posts: readonly Post[] }): ReactElement => {
  const photos = props.posts.filter((post) => photoOf(post.photo) !== null);
  if (photos.length === 0) return <p className="feed-empty">{EXPLORE_COPY.photosEmpty}</p>;
  return (
    <ul className="photo-grid">
      {photos.map((post) => (
        <li key={post.postId}>
          <Link className="photo-cell" to={personPostsPath(post.listingId)} aria-label={`${post.displayName}'s posts: ${post.photoAlt ?? post.text}`}>
            <img src={photoOf(post.photo)?.src} alt="" loading="lazy" decoding="async" />
            <span className="photo-cell-who" aria-hidden="true">
              <PersonAvatar name={post.displayName} size="s" photo={post.authorPhoto} isSample={post.isSample} />
              <b>{post.displayName}</b>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
};

// What the tabs show: the posts of the chosen tab once they load, the loading line until then, and the line with Try again when they
// failed.
const FeedPanel = (props: { tab: FeedTab; baseId: string; browse: BrowseHook; posts: PolledView<PostsView>; friends: ExploreFriends; onSeeAll: () => void }): ReactElement => {
  const { posts } = props;
  const list = posts.value?.posts ?? [];
  return (
    <section className="feed" id={`${props.baseId}-panel`} role="tabpanel" aria-labelledby={`${props.baseId}-${props.tab}`}>
      <h2 className="hidden-words">{EXPLORE_COPY.feedLabel}</h2>
      {props.tab === "photos" && posts.value !== null ? <PhotoGrid posts={list} /> : null}
      {props.tab === "photos" ? null : (
        <Feed browse={props.browse} posts={list} friends={props.friends} onSeeAll={props.onSeeAll} isFriendsOnly={props.tab === "friends"} />
      )}
      {posts.value === null && posts.error === null ? <LoadingLine text={EXPLORE_COPY.loadingPosts} /> : null}
      <PostsFailed posts={posts} />
    </section>
  );
};

// The right-hand column on a laptop, after the "Other" concept: a warm card on what your Meety does, with slow circles drawn in its
// corner and a link to what it shares, then a few people you are not friends with yet, each with Add friend, and See everyone beside
// their heading.
const ExploreRail = (props: { browse: BrowseHook; friends: ExploreFriends; onSeeAll: () => void }): ReactElement => {
  const { browse, friends } = props;
  const people = browse.listings.filter((listing) => !friends.isFriend(listing.listingId)).slice(0, RAIL_PEOPLE_MAX);
  return (
    <aside className="explore-rail" aria-label={EXPLORE_COPY.railLabel}>
      <section className="rail-meety" aria-labelledby="rail-meety-title">
        <span className="rail-orbit" aria-hidden="true"><i /><i /><i /></span>
        <p className="rail-meety-label">{EXPLORE_COPY.meetyLabel}</p>
        <h2 id="rail-meety-title">{EXPLORE_COPY.meetyTitle}</h2>
        <p className="rail-meety-line">{EXPLORE_COPY.meetyLine}</p>
        <Link className="rail-meety-link" to={APP_PATHS.me}>
          {EXPLORE_COPY.meetyLink}
          <Icon name="arrow" size={18} />
        </Link>
      </section>
      {people.length === 0 ? null : (
        <section className="rail-people" aria-labelledby="rail-people-title">
          <div className="explore-head">
            <h2 id="rail-people-title">{EXPLORE_COPY.clickTitle}</h2>
            <button type="button" className="text-button rail-see-everyone" onClick={props.onSeeAll}>{EXPLORE_COPY.seeEveryone}</button>
          </div>
          <ul className="rail-people-list">
            {people.map((listing) => (
              <li key={listing.listingId} className="rail-person">
                <PersonAvatar name={listing.displayName} photo={listing.photo} isSample={listing.isSample} />
                <span className="rail-person-words">
                  <Link to={APP_PATHS.person(listing.listingId)}>{listing.displayName}</Link>
                  <small>{lineFor(listing.line, friends.adds.stateOf(listing.listingId))}</small>
                </span>
                <FriendControl listing={listing} friends={friends} look="row" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
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

// The /explore page as a feed (Ambar, 3 Nov 2026: "it should have been looking like linkedin or instagram feed"), in the look of the
// "Other" concept and of Instagram he asked for the same day ("I WANT THE OTHERS AND INSTAGRAM LOOK"): a small line, the large title and
// today's date, the search box with a way to ask Meety for help, the row of faces, then For you, Friends and Photos; a search, or See
// all, shows people as rows instead. On a laptop the right-hand column sits beside it.
export const ExploreScreen = (): ReactElement => {
  const browse = useDirectoryBrowse();
  const posts = useExplorePosts();
  const friends = useExploreFriends();
  const baseId = useId();
  const [tab, setTab] = useState<FeedTab>("all");
  const [isEveryone, setIsEveryone] = useState(false);
  const isSearching = browse.query !== "";
  const isPeople = isSearching || isEveryone;
  const search = (query: string): void => {
    setIsEveryone(false);
    browse.search(query);
  };
  const seeAll = (): void => { setIsEveryone(true); };
  const people = browse.listings.length === 0 ? null : (
    <PeopleList browse={browse} friends={friends} onBack={isSearching ? null : () => { setIsEveryone(false); }} />
  );
  return (
    <ScreenFrame title={EXPLORE_COPY.title} hasOwnHeading isWide>
      <div className="explore">
        <div className="explore-main">
          <div className="explore-title">
            <div>
              <p className="explore-eyebrow">{EXPLORE_COPY.eyebrow}</p>
              <h1>{EXPLORE_COPY.title}</h1>
            </div>
            <p className="explore-date">{todayWords(new Date())}</p>
          </div>
          <SearchForm onSearch={search} />
          <p className="explore-stuck">
            {`${EXPLORE_COPY.stuck} `}
            <Link to={APP_PATHS.home}>{EXPLORE_COPY.askOrchestrator}</Link>
          </p>
          <ExploreStatus browse={browse} isEmpty={isNothingShown(browse, posts, isPeople)} />
          {isPeople ? people : (
            <>
              {browse.listings.length === 0 ? null : <StoriesRow browse={browse} friends={friends} />}
              <FeedTabs selected={tab} onSelect={setTab} baseId={baseId} />
              <FeedPanel tab={tab} baseId={baseId} browse={browse} posts={posts} friends={friends} onSeeAll={seeAll} />
            </>
          )}
        </div>
        <ExploreRail browse={browse} friends={friends} onSeeAll={seeAll} />
      </div>
    </ScreenFrame>
  );
};
