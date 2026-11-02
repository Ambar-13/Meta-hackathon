import "./social-rail.css";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { Friend } from "@meet-first/contracts";
import { APP_PATHS } from "./app-paths.js";
import { friendsLinkName, RAIL_FRIENDS_MAX, useRailData } from "./social-rail-state.js";
import { Avatar, Sticker, type StickerName } from "../look/index.js";

// One page of the signed-in nav: its words, where it goes, its sticker, and whether only the laptop rail shows it.
type RailPage = { label: string; to: string; sticker: StickerName; isRailOnly?: boolean };
// The pages, in this order: Chat, Explore, Friends, Me, then Settings, which the phone keeps in the top bar instead (wave 7).
const RAIL_PAGES: readonly RailPage[] = [
  { label: "Chat", to: APP_PATHS.home, sticker: "chat" },
  { label: "Explore", to: APP_PATHS.explore, sticker: "lens" },
  { label: "Friends", to: APP_PATHS.friends, sticker: "smile" },
  { label: "Me", to: APP_PATHS.me, sticker: "tags" },
  { label: "Settings", to: APP_PATHS.settings, sticker: "gear", isRailOnly: true },
];
// The words of the rail's friend list.
const RAIL_COPY = { heading: "Friends", seeAll: "See all friends", none: "No friends yet.", find: "Find people in Explore" } as const;

// One page link, with the request count after Friends when there are requests; the count is part of the link's name.
const PageLink = (props: { page: RailPage; pathname: string; incomingCount: number }): ReactElement => {
  const { page } = props;
  const isFriends = page.to === APP_PATHS.friends;
  const hasCount = isFriends && props.incomingCount > 0;
  return (
    <Link
      to={page.to}
      className={page.isRailOnly === true ? "rail-only" : undefined}
      aria-current={props.pathname === page.to ? "page" : undefined}
      aria-label={hasCount ? friendsLinkName(props.incomingCount) : undefined}
    >
      <Sticker name={page.sticker} />
      <span className="page-word">
        {page.label}
        {hasCount ? <span className="count-pill" aria-hidden="true">{String(props.incomingCount)}</span> : null}
      </span>
    </Link>
  );
};

// The friends under the pages on a laptop: up to RAIL_FRIENDS_MAX, each linking to their profile when they are in Explore.
const RailFriends = (props: { friends: Friend[] }): ReactElement => {
  const shown = props.friends.slice(0, RAIL_FRIENDS_MAX);
  return (
    <nav className="rail-friends" aria-label="Friends">
      <p className="rail-heading">{RAIL_COPY.heading}</p>
      {shown.length === 0 ? (
        <>
          <p className="rail-none">{RAIL_COPY.none}</p>
          <Link className="rail-find" to={APP_PATHS.explore}>{RAIL_COPY.find}</Link>
        </>
      ) : (
        <ul>
          {shown.map((friend, index) => (
            <li key={friend.pairId}>
              <Link to={friend.listingId === null ? APP_PATHS.friends : APP_PATHS.person(friend.listingId)}>
                <Avatar name={friend.displayName} side={index % 2 === 0 ? "b" : "a"} isSmall />
                <span>{friend.displayName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {props.friends.length > RAIL_FRIENDS_MAX ? <Link className="rail-find" to={APP_PATHS.friends}>{RAIL_COPY.seeAll}</Link> : null}
    </nav>
  );
};

// The signed-in nav: a left rail with the logo, the pages and your friends on a laptop, and a bottom tab bar on a phone. It is one
// Pages nav at both widths; the stylesheet moves it. hasSettingsLink is false on the Settings page itself.
export const SocialRail = (props: { pathname: string; hasSettingsLink: boolean }): ReactElement => {
  const rail = useRailData();
  const pages = props.hasSettingsLink ? RAIL_PAGES : RAIL_PAGES.filter((page) => page.to !== APP_PATHS.settings);
  return (
    <div className="social-rail">
      <Link className="logo rail-logo" to={APP_PATHS.home}>
        <Sticker name="tags" />
        Meet First
      </Link>
      <nav className="tab-bar social-pages" aria-label="Pages">
        {pages.map((page) => (
          <PageLink key={page.to} page={page} pathname={props.pathname} incomingCount={rail.incomingCount} />
        ))}
      </nav>
      {rail.friends === null ? null : <RailFriends friends={rail.friends} />}
    </div>
  );
};
