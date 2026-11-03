import "./explore.css";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing, Post, PublicItem } from "@meet-first/contracts";
import { APP_PATHS, chatPathWithDraft, ErrorNotice, personPostsPath, PROFILE_TAB_QUERY, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, MeetyMark, PersonAvatar, photoOf, PostPhoto } from "../../look/index.js";
import { NextStep } from "../chat/index.js";
import { useDirectoryBrowse, type BrowseHook } from "../directory/index.js";
import { DeletePost, postAgeWords } from "../people/index.js";
import { noteItemFor, peopleRowAt, useExploreFriends, useFeedHome, type ExploreFriends } from "./explore-state.js";
import { useEndlessFeed, type EndlessFeed } from "./feed-state.js";
import { FriendControl, lineFor, PersonCard } from "./people-parts.js";
import { StoriesRow } from "./stories.js";
import { useLikes, useStories, type LikesModel } from "./story-state.js";

// The words of Home, the feed.
const FEED_COPY = {
  title: "Home",
  eyebrow: "People, not just posts.",
  loading: "Loading people.",
  loadingPosts: "Loading posts.",
  emptyTitle: "Nothing here yet",
  emptyLine: "Nobody has posted yet. Find people in Search.",
  retry: "Try again",
  postsFailed: "Posts did not load.",
  caughtUp: "You're all caught up",
  caughtUpLine: "You've seen every post from your friends.",
  othersTitle: "Suggested posts",
  othersLine: "Your friends' posts show here first.",
  findFriends: "Find friends in Search",
  end: "That's every post for now.",
  endLink: "Find people in Search",
  morePosts: "Show more posts",
  feedLabel: "Posts",
  yourPost: "Your post",
  yourPosts: "Your posts",
  more: "Show more",
  sample: "Sample person",
  suggestedTitle: "Suggested for you",
  seeAll: "See all",
  railLabel: "Your Meety and people you might click with",
  meetyLabel: "Meet your Meety",
  meetyTitle: "You're more than your posts.",
  meetyLine: "Your Meety answers your friends' questions from what you chose to share, and every answer shows your own words.",
  meetyLink: "See what it shares",
  clickTitle: "People you might click with",
  seeEveryone: "See everyone",
} as const;
// How many people the right-hand column suggests.
const RAIL_PEOPLE_MAX = 4;
// A post of words longer than this shows in the smaller type of its card.
const LONG_POST_CHARS = 160;

// A listing for the Add friend button of a post whose writer is not on the loaded pages of Explore.
function listingOfPost(post: Post): DirectoryListing {
  return { listingId: post.listingId, displayName: post.displayName, line: "", openToRomance: false, isSample: post.isSample, items: [], photo: post.authorPhoto ?? null };
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

// A post's head: the writer's picture (a sample person's face with the orange mark), their name, the post's age and their line, with
// Add friend at the end; your own post leads to your own profile and has no Add friend.
const FeedHead = (props: { post: Post; listing: DirectoryListing | undefined; friends: ExploreFriends }): ReactElement => {
  const { post, friends } = props;
  const listing = props.listing ?? listingOfPost(post);
  const profile = post.isMine === true ? APP_PATHS.me : APP_PATHS.person(post.listingId);
  const line = lineFor(listing.line, friends.adds.stateOf(post.listingId));
  return (
    <header className="feed-head">
      <Link className="feed-avatar" to={profile} tabIndex={-1} aria-hidden="true">
        <PersonAvatar name={post.displayName} photo={post.authorPhoto} isSample={post.isSample} />
      </Link>
      <div className="feed-who">
        <p className="feed-name-row">
          <Link className="feed-name" to={profile}>{post.displayName}</Link>
          {post.isSample ? <span className="hidden-words">{FEED_COPY.sample}</span> : null}
          <time className="feed-time" dateTime={post.createdAt}>{postAgeWords(post.createdAt, new Date())}</time>
        </p>
        {line === "" ? null : <p className="feed-line">{line}</p>}
      </div>
      {post.isMine === true ? null : <FriendControl listing={listing} friends={friends} look="post" />}
    </header>
  );
};

// A post's body: its words over its photo, or, with no photo, its words large on a warm card. A photo with no words shows alone.
const FeedBody = (props: { post: Post }): ReactElement => {
  const { post } = props;
  if (photoOf(post.photo) === null) {
    return (
      <blockquote className={post.text.length > LONG_POST_CHARS ? "feed-quote is-long" : "feed-quote"}>
        <p>{post.text}</p>
      </blockquote>
    );
  }
  return (
    <>
      {post.text === "" ? null : <p className="feed-text">{post.text}</p>}
      <PostPhoto photo={post.photo} alt={post.photoAlt ?? `${post.displayName}'s photo`} className="feed-photo" />
    </>
  );
};

// Ask NAME's Meety, which opens the chat with a friend ask when it can, and else says why under the post.
const AskAction = (props: { post: Post; friends: ExploreFriends }): ReactElement => {
  const { post, friends } = props;
  const [isWhyOpen, setIsWhyOpen] = useState(false);
  const askLabel = `Ask ${post.displayName}'s Meety`;
  if (friends.canAsk(post.listingId)) {
    return (
      <Link className="feed-action is-ask" to={chatPathWithDraft(`How would ${post.displayName} react to `)}>
        <Icon name="meety" size={20} />
        {askLabel}
      </Link>
    );
  }
  return (
    <>
      <button type="button" className="feed-action is-ask" aria-expanded={isWhyOpen} onClick={() => { setIsWhyOpen(!isWhyOpen); }}>
        <Icon name="meety" size={20} />
        {askLabel}
      </button>
      {isWhyOpen ? <p className="feed-why" role="status">{askWhyNot(post.displayName, post.listingId, friends)}</p> : null}
    </>
  );
};

// A post's foot: Like, the heart filled red once you like it, then Ask NAME's Meety and Posts, their Posts tab; on your own post, Like,
// Posts, your own Posts tab, and Delete.
const FeedFoot = (props: { post: Post; friends: ExploreFriends; likes: LikesModel; onDeleted: () => void }): ReactElement => {
  const { post, likes } = props;
  const isMine = post.isMine === true;
  return (
    <footer className="feed-actions">
      <button type="button" className="feed-action" aria-pressed={likes.isLiked(post)} aria-label={isMine ? "Like your post" : `Like ${post.displayName}'s post`} onClick={() => void likes.toggle(post)}>
        <Icon name="heart" size={20} />
        Like
      </button>
      {isMine ? null : <AskAction post={post} friends={props.friends} />}
      <Link className="feed-action" to={isMine ? `${APP_PATHS.me}?${PROFILE_TAB_QUERY}=posts` : personPostsPath(post.listingId)} aria-label={isMine ? FEED_COPY.yourPosts : `${post.displayName}'s posts`}>
        <Icon name="posts" size={20} />
        Posts
      </Link>
      {isMine ? <DeletePost postId={post.postId} onDeleted={props.onDeleted} buttonClass="feed-action" /> : null}
    </footer>
  );
};

// One post, after the "Other" concept and Instagram: the head, the body, the strip tying it to what its writer shared, and the foot.
const FeedPost = (props: { post: Post; listing: DirectoryListing | undefined; friends: ExploreFriends; likes: LikesModel; onDeleted: () => void }): ReactElement => {
  const { post } = props;
  const item = noteItemFor(post, props.listing);
  return (
    <article className="feed-post" aria-label={post.isMine === true ? FEED_COPY.yourPost : `${post.displayName}'s post`}>
      <FeedHead post={post} listing={props.listing} friends={props.friends} />
      <FeedBody post={post} />
      {item === null ? null : <FeedNote post={post} item={item} />}
      <FeedFoot post={post} friends={props.friends} likes={props.likes} onDeleted={props.onDeleted} />
    </article>
  );
};

// The row of people Explore suggests, inside the feed on a phone and a tablet (the laptop has the right-hand column instead): cards that
// scroll sideways, See all at the top opening Search, and Show more at the end while more pages exist.
const SuggestedRow = (props: { browse: BrowseHook; friends: ExploreFriends }): ReactElement => {
  const { browse, friends } = props;
  return (
    <section className="suggested" aria-labelledby="suggested-title">
      <div className="explore-head">
        <h2 id="suggested-title">{FEED_COPY.suggestedTitle}</h2>
        <Link className="explore-head-link" to={APP_PATHS.search}>{FEED_COPY.seeAll}</Link>
      </div>
      <ul className="person-cards">
        {browse.listings.map((listing) => <PersonCard key={listing.listingId} listing={listing} friends={friends} />)}
        {browse.hasMore ? (
          <li className="person-card is-more">
            <button type="button" className="quiet" disabled={browse.isLoading} onClick={browse.loadMore}>{FEED_COPY.more}</button>
          </li>
        ) : null}
      </ul>
    </section>
  );
};

// The line under the feed when a page did not load, with Try again, which asks for the same page again.
const PostsFailed = (props: { feed: EndlessFeed }): ReactElement | null => {
  if (props.feed.error === null) return null;
  return (
    <p className="explore-posts-failed">
      {`${FEED_COPY.postsFailed} `}
      <button type="button" className="text-button" onClick={props.feed.loadMore}>{FEED_COPY.retry}</button>
    </p>
  );
};

// The line between your friends' posts and everyone else's, as Instagram's "You're all caught up": a check in a ring and the words over
// the posts that follow, under the heading Suggested posts. With none of your friends' posts above it, only the heading shows, with where
// theirs will go.
const CaughtUp = (props: { hasFriendsPosts: boolean; hasOthers: boolean }): ReactElement => {
  return (
    <li className="feed-caught-up">
      {props.hasFriendsPosts ? (
        <div className="caught-up">
          <span className="caught-up-check" aria-hidden="true"><Icon name="check" size={30} /></span>
          <h2>{FEED_COPY.caughtUp}</h2>
          <p>{FEED_COPY.caughtUpLine}</p>
        </div>
      ) : null}
      {props.hasOthers ? <h2 className="feed-others-title">{FEED_COPY.othersTitle}</h2> : null}
      {props.hasFriendsPosts ? null : (
        <p className="feed-others-line">
          {`${FEED_COPY.othersLine} `}
          <Link to={APP_PATHS.search}>{FEED_COPY.findFriends}</Link>
        </p>
      )}
    </li>
  );
};

// Calls onNear when the element at the feed's end comes within 800px of the screen, so the next page loads before the reader gets there.
// The watch starts again after each page, so a page too short to fill the screen loads the one after it. Where the browser has no
// IntersectionObserver nothing happens, and Show more posts does it by hand.
function useNearEnd(onNear: () => void, isActive: boolean): (element: HTMLDivElement | null) => void {
  const latest = useRef(onNear);
  latest.current = onNear;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (element === null || !isActive || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current();
    }, { rootMargin: "800px 0px" });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [element, isActive]);
  return setElement;
}

// The foot of the feed: loading, a failed page with Try again, Show more posts while more pages exist, and, at the end, a line that
// says so with a link to Search, so the feed ends honestly instead of filling itself with anything.
const FeedEnd = (props: { feed: EndlessFeed; nearEnd: (element: HTMLDivElement | null) => void }): ReactElement => {
  const { feed } = props;
  return (
    <div className="feed-foot" ref={props.nearEnd}>
      {feed.isLoading ? <LoadingLine text={FEED_COPY.loadingPosts} /> : null}
      <PostsFailed feed={feed} />
      {!feed.isLoading && feed.error === null && feed.hasLoaded && feed.part !== "end" ? (
        <button type="button" className="quiet feed-more" onClick={feed.loadMore}>{FEED_COPY.morePosts}</button>
      ) : null}
      {feed.part === "end" ? (
        <p className="feed-end">
          {`${FEED_COPY.end} `}
          <Link to={APP_PATHS.search}>{FEED_COPY.endLink}</Link>
        </p>
      ) : null}
    </div>
  );
};

// The entries of the feed in order: your friends' posts, then the line between the parts once your friends' posts have run out and there
// is anything around it, then everyone else's posts.
function feedEntries(feed: EndlessFeed): Array<Post | "caught-up"> {
  const isPastFriends = feed.part !== "friends" && (feed.friends.length > 0 || feed.others.length > 0 || feed.part === "others");
  return [...feed.friends, ...(isPastFriends ? ["caught-up" as const] : []), ...feed.others];
}

// The feed, endless and honest: your friends' posts and your own a page at a time, the
// line that you are all caught up, then everyone else's, the next page loading as you near the end, until the end says so. The row of
// suggested people sits after the second post; each post's line comes from the loaded people.
const Feed = (props: { browse: BrowseHook; feed: EndlessFeed; friends: ExploreFriends; likes: LikesModel }): ReactElement => {
  const { browse, feed, friends, likes } = props;
  const nearEnd = useNearEnd(feed.loadMore, feed.hasLoaded && !feed.isLoading && feed.error === null && feed.part !== "end");
  const entries = feedEntries(feed);
  const at = peopleRowAt(feed.friends.length + feed.others.length);
  const byListing = new Map(browse.listings.map((listing) => [listing.listingId, listing]));
  const suggested = browse.listings.length === 0 ? null : <li key="suggested" className="feed-suggested"><SuggestedRow browse={browse} friends={friends} /></li>;
  let posts = 0;
  const items = entries.flatMap((entry): ReactElement[] => {
    if (entry === "caught-up") return [<CaughtUp key="caught-up" hasFriendsPosts={feed.friends.length > 0} hasOthers={feed.others.length > 0 || feed.part === "others"} />];
    posts += 1;
    const item = <li key={entry.postId}><FeedPost post={entry} listing={byListing.get(entry.listingId)} friends={friends} likes={likes} onDeleted={() => { feed.remove(entry.postId); }} /></li>;
    return posts === at && suggested !== null ? [item, suggested] : [item];
  });
  return (
    <section className="feed" aria-label={FEED_COPY.feedLabel}>
      {likes.error === null ? null : <ErrorNotice error={likes.error} />}
      <ul className="feed-list">
        {at === 0 ? suggested : null}
        {items}
      </ul>
      <FeedEnd feed={feed} nearEnd={nearEnd} />
    </section>
  );
};

// The right-hand column on a laptop, after the "Other" concept: a warm card on what your Meety does, with slow circles drawn in its
// corner and a link to what it shares, then a few people you are not friends with yet, each with Add friend, and See everyone beside
// their heading, opening Search.
const FeedRail = (props: { browse: BrowseHook; friends: ExploreFriends }): ReactElement => {
  const { browse, friends } = props;
  const people = browse.listings.filter((listing) => !friends.isFriend(listing.listingId)).slice(0, RAIL_PEOPLE_MAX);
  return (
    <aside className="explore-rail" aria-label={FEED_COPY.railLabel}>
      <section className="rail-meety" aria-labelledby="rail-meety-title">
        <span className="rail-orbit" aria-hidden="true"><i /><i /><i /></span>
        <p className="rail-meety-label">{FEED_COPY.meetyLabel}</p>
        <h2 id="rail-meety-title">{FEED_COPY.meetyTitle}</h2>
        <p className="rail-meety-line">{FEED_COPY.meetyLine}</p>
        <Link className="rail-meety-link" to={APP_PATHS.me}>
          {FEED_COPY.meetyLink}
          <Icon name="arrow" size={18} />
        </Link>
      </section>
      {people.length === 0 ? null : (
        <section className="rail-people" aria-labelledby="rail-people-title">
          <div className="explore-head">
            <h2 id="rail-people-title">{FEED_COPY.clickTitle}</h2>
            <Link className="explore-head-link" to={APP_PATHS.search}>{FEED_COPY.seeEveryone}</Link>
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

// The states above the feed: an error with Try again, loading, and nothing to show yet.
const FeedStatus = (props: { browse: BrowseHook; isEmpty: boolean }): ReactElement => {
  const { browse } = props;
  return (
    <>
      {browse.error === null ? null : (
        <div className="explore-error">
          <ErrorNotice error={browse.error} />
          <button type="button" className="quiet" onClick={() => { browse.search(browse.query); }}>{FEED_COPY.retry}</button>
        </div>
      )}
      {browse.isLoading && !browse.hasLoaded ? <LoadingLine text={FEED_COPY.loading} /> : null}
      {props.isEmpty ? <EmptyState sticker="lens" title={FEED_COPY.emptyTitle} action={<Link className="btn" to={APP_PATHS.search}>Search</Link>}>{FEED_COPY.emptyLine}</EmptyState> : null}
    </>
  );
};

// True when the feed has nothing to show: nobody in Explore and no posts, once both have loaded to their end or failed.
function isNothingShown(browse: BrowseHook, feed: EndlessFeed): boolean {
  const isNobody = browse.hasLoaded && !browse.isLoading && browse.error === null && browse.listings.length === 0;
  const hasNoPosts = feed.friends.length === 0 && feed.others.length === 0 && (feed.part === "end" || feed.error !== null);
  return isNobody && hasNoPosts;
}

// Home, the feed, as Instagram's home, in the look of the "Other" concept: on a laptop a small line over the title with today's date at
// the right, which a phone leaves out as Instagram does; your next step while you have no approved card; the row of stories; then the
// posts with the people Explore suggests. On a laptop the right-hand column sits beside it.
export const FeedScreen = (): ReactElement => {
  const browse = useDirectoryBrowse();
  const feed = useEndlessFeed();
  const friends = useExploreFriends();
  const home = useFeedHome();
  const stories = useStories();
  const likes = useLikes();
  const me = home.value === null ? null : { name: home.value.displayName, photo: home.value.photo ?? null };
  return (
    <ScreenFrame title={FEED_COPY.title} hasOwnHeading isWide>
      <div className="explore">
        <div className="explore-main">
          <div className="explore-title">
            <div>
              <p className="explore-eyebrow">{FEED_COPY.eyebrow}</p>
              <h1>{FEED_COPY.title}</h1>
            </div>
            <p className="explore-date">{todayWords(new Date())}</p>
          </div>
          {home.value === null ? null : <NextStep home={home.value} />}
          <FeedStatus browse={browse} isEmpty={isNothingShown(browse, feed)} />
          <StoriesRow stories={stories} me={me} friends={friends} />
          <Feed browse={browse} feed={feed} friends={friends} likes={likes} />
        </div>
        <FeedRail browse={browse} friends={friends} />
      </div>
    </ScreenFrame>
  );
};
