import "./social-rail.css";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { APP_PATHS } from "./app-paths.js";
import { friendsLinkName, useRailData } from "./social-rail-state.js";
import { Icon, Sticker, type IconName } from "../look/index.js";

// One page of the signed-in nav: its words, where it goes, its line icon, and whether only the laptop rail shows it.
type RailPage = { label: string; to: string; icon: IconName; isRailOnly?: boolean };
// The pages, in this order: Meety (the chat), Explore, Friends, Me, then Settings, which the laptop rail keeps at its foot and the
// phone keeps in the top bar instead (wave 7).
const RAIL_PAGES: readonly RailPage[] = [
  { label: "Meety", to: APP_PATHS.home, icon: "meety" },
  { label: "Explore", to: APP_PATHS.explore, icon: "explore" },
  { label: "Friends", to: APP_PATHS.friends, icon: "friends" },
  { label: "Me", to: APP_PATHS.me, icon: "me" },
  { label: "Settings", to: APP_PATHS.settings, icon: "settings", isRailOnly: true },
];

// One page link: its icon, with the request count on the Friends icon, and its words, which screen readers read and the laptop shows
// as a label beside the icon on hover, as Instagram's rail does.
const PageLink = (props: { page: RailPage; pathname: string; incomingCount: number }): ReactElement => {
  const { page } = props;
  const hasCount = page.to === APP_PATHS.friends && props.incomingCount > 0;
  const isCurrent = props.pathname === page.to;
  return (
    <Link
      to={page.to}
      className={page.isRailOnly === true ? "rail-only" : undefined}
      aria-current={isCurrent ? "page" : undefined}
      aria-label={hasCount ? friendsLinkName(props.incomingCount) : undefined}
      data-label={page.label}
    >
      <span className="page-icon">
        <Icon name={page.icon} size={26} isBold={isCurrent} />
        {hasCount ? <span className="count-pill" aria-hidden="true">{String(props.incomingCount)}</span> : null}
      </span>
      <span className="page-word">{page.label}</span>
    </Link>
  );
};

// The signed-in nav, after Instagram's: a narrow rail of icons on a laptop, the logo at its top and Settings at its foot, and a bottom
// tab bar of icons on a phone. It is one Pages nav at both widths; the stylesheet moves it. hasSettingsLink is false on Settings itself.
export const SocialRail = (props: { pathname: string; hasSettingsLink: boolean }): ReactElement => {
  const rail = useRailData();
  const pages = props.hasSettingsLink ? RAIL_PAGES : RAIL_PAGES.filter((page) => page.to !== APP_PATHS.settings);
  return (
    <div className="social-rail">
      <Link className="rail-logo" to={APP_PATHS.home} aria-label="Meet First home">
        <Sticker name="tags" />
      </Link>
      <nav className="tab-bar social-pages" aria-label="Pages">
        {pages.map((page) => (
          <PageLink key={page.to} page={page} pathname={props.pathname} incomingCount={rail.incomingCount} />
        ))}
      </nav>
    </div>
  );
};
