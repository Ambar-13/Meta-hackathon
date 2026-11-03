import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { Post, PostsView, PublicItem } from "@meet-first/contracts";
import { ErrorNotice, type PolledView } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, PersonAvatar, photoOf, PostPhoto, Receipt, SampleChip } from "../../look/index.js";
import { postAgeWords, postsSoonCopy } from "./people-state.js";

// The tabs under a profile header, in order, with their icons; Meetings shows only on your own profile.
const TABS = [
  { key: "about", label: "About", icon: "about" },
  { key: "posts", label: "Posts", icon: "posts" },
  { key: "meetings", label: "Meetings", icon: "meetings" },
] as const;
// One tab's key.
export type TabKey = (typeof TABS)[number]["key"];
// The line under a sample person's name, so nobody takes them for a real person.
const SAMPLE_NOTE = "A sample person, not a real one. Friend requests to them are accepted at once.";

// The Instagram-style header of a profile: the person's round picture, then the name as the h1, the line, the sample note for a sample
// person, and the buttons. No count of anything about the person shows here (PRODUCT.md principle 5). On a phone the picture sits left
// of the name and the buttons go full width under them.
export const ProfileHeader = (props: { name: string; line: string | null; isSample?: boolean; photo?: string | null | undefined; children: ReactNode }): ReactElement => {
  return (
    <header className="profile-head">
      <PersonAvatar name={props.name} size="xl" className="profile-avatar" photo={props.photo} isSample={props.isSample} />
      <div className="profile-words">
        <h1>{props.name}</h1>
        {props.line === null ? null : <p className="profile-line">{props.line}</p>}
        {props.isSample === true ? (
          <p className="profile-sample">
            <SampleChip />
            {SAMPLE_NOTE}
          </p>
        ) : null}
        <div className="profile-buttons">{props.children}</div>
      </div>
    </header>
  );
};

// The coming-soon card of the Posts tab: the own-profile words when name is null, else the words about that person's agent.
export const PostsSoonCard = (props: { name: string | null }): ReactElement => {
  const copy = postsSoonCopy(props.name);
  return (
    <section className="posts-soon">
      <span className="posts-soon-icon">
        <Icon name="posts" size={30} />
      </span>
      <h2>{copy.heading}</h2>
      <p>{copy.body}</p>
    </section>
  );
};

// The About tab: each public item as a quote card, the claim as text and the quote under it.
const AboutPanel = (props: { items: PublicItem[]; source: string }): ReactElement => {
  if (props.items.length === 0) return <EmptyState sticker="quote" title="Nothing shared yet" />;
  return (
    <ul className="about-items">
      {props.items.map((item, index) => (
        <li key={`${String(index)}-${item.claim}`} className="about-item">
          <p className="about-claim">{item.claim}</p>
          <Receipt quote={item.quote} source={props.source} />
        </li>
      ))}
    </ul>
  );
};

// How the Posts tab shows the posts: a grid of square tiles, as Instagram shows a profile, or one under another.
type PostsLook = "grid" | "list";
// The two ways, with their words and icons, in the order of the switch.
const POSTS_LOOKS = [
  { key: "grid", label: "Grid", icon: "grid" },
  { key: "list", label: "List", icon: "list" },
] as const;

// The switch between the grid and the list, as two buttons that say which one is on.
const LookSwitch = (props: { look: PostsLook; onChange: (look: PostsLook) => void }): ReactElement => {
  return (
    <div className="posts-look" role="group" aria-label="Show posts as">
      {POSTS_LOOKS.map((option) => (
        <button key={option.key} type="button" className="posts-look-button" aria-pressed={props.look === option.key} onClick={() => { props.onChange(option.key); }}>
          <Icon name={option.icon} size={18} />
          {option.label}
        </button>
      ))}
    </div>
  );
};

// The grid: three square tiles to a row with square corners, a photo post as its photo and a post of words as its words on a soft
// ground. A tile opens its post in the list.
const PostGrid = (props: { posts: readonly Post[]; onOpen: (postId: string) => void }): ReactElement => {
  return (
    <ul className="post-grid">
      {props.posts.map((post) => {
        const found = photoOf(post.photo);
        return (
          <li key={post.postId}>
            <button type="button" className={found === null ? "post-tile is-words" : "post-tile"} onClick={() => { props.onOpen(post.postId); }}>
              {found === null ? <span className="post-tile-words">{post.text}</span> : <img src={found.src} alt={post.photoAlt ?? post.text} loading="lazy" decoding="async" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

// The list: each post with its photo when it has one and how long ago it went up. The post opened from the grid scrolls into view and
// takes the focus, so the reader lands on it.
const PostList = (props: { posts: readonly Post[]; openId: string | null }): ReactElement => {
  const now = new Date();
  const openRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const opened = openRef.current;
    if (opened === null) return;
    if (typeof opened.scrollIntoView === "function") opened.scrollIntoView({ block: "start" });
    opened.focus({ preventScroll: true });
  }, [props.openId]);
  return (
    <ul className="profile-posts">
      {props.posts.map((post) => (
        <li key={post.postId} className="profile-post" ref={post.postId === props.openId ? openRef : undefined} tabIndex={post.postId === props.openId ? -1 : undefined}>
          <p className="post-text">{post.text}</p>
          <PostPhoto photo={post.photo} alt={post.photoAlt} />
          <time className="post-time" dateTime={post.createdAt}>{postAgeWords(post.createdAt, now)}</time>
        </li>
      ))}
    </ul>
  );
};

// The Posts tab: the person's posts, newest first. With a photo among them they open as the grid, with the switch to the list; posts
// of words alone show as the list with no switch. The coming-soon card shows when there are none.
const PostsPanel = (props: { posts: PolledView<PostsView> | null; name: string | null }): ReactElement => {
  const { posts } = props;
  const [chosenLook, setChosenLook] = useState<PostsLook | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  if (posts === null) return <PostsSoonCard name={props.name} />;
  if (posts.value === null) {
    if (posts.error === null) return <LoadingLine text="Loading posts." />;
    return (
      <div className="profile-posts-error">
        <ErrorNotice error={posts.error} />
        <button type="button" className="quiet" onClick={posts.reload}>Try again</button>
      </div>
    );
  }
  const list = posts.value.posts;
  if (list.length === 0) return <PostsSoonCard name={props.name} />;
  const hasPhotos = list.some((post) => photoOf(post.photo) !== null);
  const look = hasPhotos ? (chosenLook ?? "grid") : "list";
  const choose = (next: PostsLook): void => {
    setOpenId(null);
    setChosenLook(next);
  };
  const open = (postId: string): void => {
    setOpenId(postId);
    setChosenLook("list");
  };
  return (
    <div className="profile-posts-panel">
      {hasPhotos ? <LookSwitch look={look} onChange={choose} /> : null}
      {look === "grid" ? <PostGrid posts={list} onOpen={open} /> : <PostList posts={list} openId={openId} />}
    </div>
  );
};

// What the tabs under a profile show: the public items with the words for their source, the Posts tab's name (null on your own
// profile) and posts (null where the page reads none), the tab it opens on, what follows the items on About, and the Meetings panel,
// which only your own profile passes.
type ProfileTabsProps = {
  items: PublicItem[];
  source: string;
  postsName: string | null;
  posts?: PolledView<PostsView> | null;
  firstTab?: TabKey;
  aboutEnd?: ReactNode;
  meetings?: ReactNode;
};

// The panel of one tab.
function panelOf(key: TabKey, props: ProfileTabsProps): ReactNode {
  if (key === "about") return <><AboutPanel items={props.items} source={props.source} />{props.aboutEnd}</>;
  if (key === "posts") return <PostsPanel posts={props.posts ?? null} name={props.postsName} />;
  return props.meetings;
}

// The About and Posts tabs under a profile, and Meetings on your own: a real tab list, where the arrow keys move between the tabs and
// each panel is labelled by its tab.
export const ProfileTabs = (props: ProfileTabsProps): ReactElement => {
  const tabs = TABS.filter((tab) => tab.key !== "meetings" || props.meetings !== undefined);
  const [selected, setSelected] = useState<TabKey>(props.firstTab ?? "about");
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const select = (key: TabKey, shouldFocus: boolean): void => {
    setSelected(key);
    if (shouldFocus) tabRefs.current[key]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tabs.findIndex((tab) => tab.key === selected);
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next !== undefined) select(next.key, true);
  };
  return (
    <div className="profile-tabs">
      <div className="tabs" role="tablist" aria-label="Profile" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(element) => { tabRefs.current[tab.key] = element; }}
            type="button"
            role="tab"
            id={`${baseId}-${tab.key}-tab`}
            aria-selected={selected === tab.key}
            aria-controls={`${baseId}-${tab.key}-panel`}
            tabIndex={selected === tab.key ? 0 : -1}
            onClick={() => { select(tab.key, false); }}
          >
            <Icon name={tab.icon} size={16} />
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" id={`${baseId}-${tab.key}-panel`} aria-labelledby={`${baseId}-${tab.key}-tab`} hidden={selected !== tab.key}>
          {panelOf(tab.key, props)}
        </div>
      ))}
    </div>
  );
};
