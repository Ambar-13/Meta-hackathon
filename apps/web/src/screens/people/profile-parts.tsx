import { useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { PublicItem } from "@meet-first/contracts";
import { EmptyState, NameTag, Receipt, Sticker } from "../../look/index.js";
import { postsSoonCopy, thingsSharedWords } from "./people-state.js";

// The two tabs under a profile header, in order.
const TABS = [
  { key: "about", label: "About" },
  { key: "posts", label: "Posts" },
] as const;
// One tab's key.
type TabKey = (typeof TABS)[number]["key"];

// The Instagram-style header of a profile: the name tag drawn large in a cobalt ring, then the name as the h1, the count of things
// shared, the line, and the buttons. On a phone it stacks, centred.
export const ProfileHeader = (props: { name: string; line: string | null; itemCount: number | null; children: ReactNode }): ReactElement => {
  return (
    <header className="profile-head">
      <span className="profile-ring">
        <NameTag name={props.name} colour="blue" className="profile-tag" />
      </span>
      <div className="profile-words">
        <h1>{props.name}</h1>
        {props.itemCount === null ? null : <p className="profile-count">{thingsSharedWords(props.itemCount)}</p>}
        {props.line === null ? null : <p className="profile-line">{props.line}</p>}
        <div className="profile-buttons">{props.children}</div>
      </div>
    </header>
  );
};

// The coming-soon card of the Posts tab: the own-profile words when name is null, else the words about that person's agent.
export const PostsSoonCard = (props: { name: string | null }): ReactElement => {
  const copy = postsSoonCopy(props.name);
  return (
    <section className="colour-panel c-yellow posts-soon">
      <Sticker name="spark" />
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

// The About and Posts tabs under a profile: a real tab list, where the arrow keys move between the tabs and each panel is labelled
// by its tab. postsName is null on your own profile.
export const ProfileTabs = (props: { items: PublicItem[]; source: string; postsName: string | null }): ReactElement => {
  const [selected, setSelected] = useState<TabKey>("about");
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
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div key={tab.key} role="tabpanel" id={`${baseId}-${tab.key}-panel`} aria-labelledby={`${baseId}-${tab.key}-tab`} hidden={selected !== tab.key}>
          {tab.key === "about" ? <AboutPanel items={props.items} source={props.source} /> : <PostsSoonCard name={props.postsName} />}
        </div>
      ))}
    </div>
  );
};
