import { useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { PostsView, PublicItem } from "@meet-first/contracts";
import { ErrorNotice, type PolledView } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, PersonAvatar, Receipt, SampleChip } from "../../look/index.js";
import { postAgeWords, postsSoonCopy, thingsSharedWords } from "./people-state.js";

// The two tabs under a profile header, in order.
const TABS = [
  { key: "about", label: "About" },
  { key: "posts", label: "Posts" },
] as const;
// One tab's key.
export type TabKey = (typeof TABS)[number]["key"];
// The line under a sample person's name, so nobody takes them for a real person.
const SAMPLE_NOTE = "A sample person, not a real one. Friend requests to them are accepted at once.";

// The Instagram-style header of a profile: the person's round picture, then the name as the h1, the count of things shared, the line,
// the sample note for a sample person, and the buttons. On a phone the picture sits left of the name and the buttons go full width
// under them.
export const ProfileHeader = (props: { name: string; line: string | null; itemCount: number | null; isSample?: boolean; children: ReactNode }): ReactElement => {
  return (
    <header className="profile-head">
      <PersonAvatar name={props.name} size="xl" className="profile-avatar" />
      <div className="profile-words">
        <h1>{props.name}</h1>
        {props.itemCount === null ? null : <p className="profile-count">{thingsSharedWords(props.itemCount)}</p>}
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

// The Posts tab: the person's posts, newest first, each with how long ago it went up; the coming-soon card when there are none.
const PostsPanel = (props: { posts: PolledView<PostsView> | null; name: string | null }): ReactElement => {
  const { posts } = props;
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
  if (posts.value.posts.length === 0) return <PostsSoonCard name={props.name} />;
  const now = new Date();
  return (
    <ul className="profile-posts">
      {posts.value.posts.map((post) => (
        <li key={post.postId} className="profile-post">
          <p className="post-text">{post.text}</p>
          <time className="post-time" dateTime={post.createdAt}>{postAgeWords(post.createdAt, now)}</time>
        </li>
      ))}
    </ul>
  );
};

// The About and Posts tabs under a profile: a real tab list, where the arrow keys move between the tabs and each panel is labelled
// by its tab. postsName is null on your own profile; posts is null where the page reads no posts; firstTab is the tab it opens on.
export const ProfileTabs = (props: { items: PublicItem[]; source: string; postsName: string | null; posts?: PolledView<PostsView> | null; firstTab?: TabKey }): ReactElement => {
  const [selected, setSelected] = useState<TabKey>(props.firstTab ?? "about");
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const select = (key: TabKey, shouldFocus: boolean): void => {
    setSelected(key);
    if (shouldFocus) tabRefs.current[key]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = TABS.findIndex((tab) => tab.key === selected);
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: TABS.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (next !== undefined) select(next.key, true);
  };
  return (
    <div className="profile-tabs">
      <div className="tabs" role="tablist" aria-label="Profile" onKeyDown={onKeyDown}>
        {TABS.map((tab) => (
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
            <Icon name={tab.key === "about" ? "about" : "posts"} size={16} />
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div key={tab.key} role="tabpanel" id={`${baseId}-${tab.key}-panel`} aria-labelledby={`${baseId}-${tab.key}-tab`} hidden={selected !== tab.key}>
          {tab.key === "about" ? <AboutPanel items={props.items} source={props.source} /> : <PostsPanel posts={props.posts ?? null} name={props.postsName} />}
        </div>
      ))}
    </div>
  );
};
