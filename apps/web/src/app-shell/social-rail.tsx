import "./social-rail.css";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { APP_PATHS } from "./app-paths.js";
import { friendsLinkName, useRailData } from "./social-rail-state.js";
import { Icon, MeetyMark, Sticker, type IconName } from "../look/index.js";

// One page of the signed-in nav: its words, where it goes, its line icon, and whether only the laptop rail shows it.
type RailPage = { label: string; to: string; icon: IconName; isRailOnly?: boolean; isPhoneHidden?: boolean };
// The pages, in this order, as Instagram's: Home (the feed), Search, Meety (the chat, where Instagram has messages), Friends, Create,
// which the phone keeps as the + of its top bar instead, Me, then Settings, which the laptop keeps at the sidebar's foot and the phone
// keeps in the top bar instead.
const RAIL_PAGES: readonly RailPage[] = [
  { label: "Home", to: APP_PATHS.home, icon: "home" },
  { label: "Search", to: APP_PATHS.search, icon: "search" },
  { label: "Meety", to: APP_PATHS.meety, icon: "meety" },
  { label: "Friends", to: APP_PATHS.friends, icon: "friends" },
  { label: "Create", to: APP_PATHS.create, icon: "create", isPhoneHidden: true },
  { label: "Me", to: APP_PATHS.me, icon: "me" },
  { label: "Settings", to: APP_PATHS.settings, icon: "settings", isRailOnly: true },
];

// The sidebar's own words on a laptop.
const RAIL_COPY = { home: "Meety home", tagline: "Your Meety meets theirs first.", invite: "Invite a friend", meety: "Your Meety", meetyLine: "Shares only what you choose" } as const;

// The class of one page link: rail-only for the one the laptop keeps at the sidebar's foot, phone-hidden for one the phone keeps elsewhere.
function pageClass(page: RailPage): string | undefined {
  if (page.isRailOnly === true) return "rail-only";
  return page.isPhoneHidden === true ? "phone-hidden" : undefined;
}

// One page link: its icon, with the request count on the Friends link, and its words, shown beside the icon in the laptop sidebar,
// under it on a phone, and on hover in the narrow rail between the two.
const PageLink = (props: { page: RailPage; pathname: string; incomingCount: number }): ReactElement => {
  const { page } = props;
  const hasCount = page.to === APP_PATHS.friends && props.incomingCount > 0;
  const isCurrent = props.pathname === page.to;
  return (
    <Link
      to={page.to}
      className={pageClass(page)}
      aria-current={isCurrent ? "page" : undefined}
      aria-label={hasCount ? friendsLinkName(props.incomingCount) : undefined}
      data-label={page.label}
    >
      <span className="page-icon">
        <Icon name={page.icon} size={24} isBold={isCurrent} />
        {hasCount ? <span className="count-pill" aria-hidden="true">{String(props.incomingCount)}</span> : null}
      </span>
      <span className="page-word">{page.label}</span>
    </Link>
  );
};

// The signed-in nav. On a laptop a sidebar: the Meety mark and words, the
// tagline, the pages with their words, Invite a friend, Settings at the foot, and a line on what your Meety shares. Between laptop and
// phone a narrow rail of icons; on a phone a bottom bar of icons with their words. It is one Pages nav at every width; the stylesheet
// moves it. hasSettingsLink is false on Settings itself.
export const SocialRail = (props: { pathname: string; hasSettingsLink: boolean }): ReactElement => {
  const rail = useRailData();
  const pages = RAIL_PAGES.filter((page) => page.isRailOnly !== true);
  const settings = props.hasSettingsLink ? RAIL_PAGES.find((page) => page.isRailOnly === true) : undefined;
  return (
    <div className="social-rail">
      <Link className="rail-logo" to={APP_PATHS.home} aria-label={RAIL_COPY.home}>
        <Sticker name="tags" />
        <span className="rail-wordmark" aria-hidden="true">Meety</span>
      </Link>
      <p className="rail-tagline">{RAIL_COPY.tagline}</p>
      <nav className="tab-bar social-pages" aria-label="Pages">
        {pages.map((page) => (
          <PageLink key={page.to} page={page} pathname={props.pathname} incomingCount={rail.incomingCount} />
        ))}
        <Link className="btn rail-invite" to={APP_PATHS.pair}>
          {RAIL_COPY.invite}
          <Icon name="add" size={18} />
        </Link>
        {settings === undefined ? null : <PageLink page={settings} pathname={props.pathname} incomingCount={0} />}
      </nav>
      <div className="rail-foot">
        <MeetyMark size="m" />
        <span>
          <b>{RAIL_COPY.meety}</b>
          <small>{RAIL_COPY.meetyLine}</small>
        </span>
      </div>
    </div>
  );
};
