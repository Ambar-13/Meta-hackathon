import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "./api-fetch.js";
import { APP_PATHS } from "./app-paths.js";
import { Sticker, type StickerName } from "../look/index.js";

// How long the copy button says Copied, 2 s [confirm] (no input gives this duration).
export const COPIED_MS = 2_000;
// The pages a visitor may open before they have a session: the start page, the claim page and the join page. The session cookie is
// HttpOnly, so the browser cannot tell whether a session exists, and the frame goes by the page instead [confirm].
const NO_SESSION_PATHS: readonly string[] = [APP_PATHS.welcome, APP_PATHS.claim, APP_PATHS.join];

// True on every page except the three above and the public share pages, which anyone with the link may open (design section 7).
function showsAppLinks(pathname: string): boolean {
  return !NO_SESSION_PATHS.includes(pathname) && !pathname.startsWith(APP_PATHS.sharePage(""));
}

// One link of the Pages nav: its words, where it goes, and the sticker drawn beside it.
type PageLink = { label: string; to: string; sticker: StickerName };
// The links into the app, in this order: Home, then the directory, the help finder and the friends list (design section 7).
const APP_LINKS: readonly PageLink[] = [
  { label: "Home", to: APP_PATHS.home, sticker: "house" },
  { label: "Directory", to: APP_PATHS.directory, sticker: "tags" },
  { label: "Find help", to: APP_PATHS.help, sticker: "buoy" },
  { label: "Friends", to: APP_PATHS.friends, sticker: "smile" },
];
// The Settings link, last in the nav on every screen except Settings itself.
const SETTINGS_LINK: PageLink = { label: "Settings", to: APP_PATHS.settings, sticker: "gear" };

// The Pages nav: a tab bar at the bottom of a phone and a pill at the top right of a laptop; on pages without a session it holds
// only Settings, as one chip at the top.
const PagesNav = (props: { links: readonly PageLink[]; hasAppLinks: boolean; pathname: string }): ReactElement => {
  return (
    <nav className={props.hasAppLinks ? "tab-bar" : "top-links"} aria-label="Pages">
      {props.links.map((link) => (
        <Link key={link.to} to={link.to} aria-current={props.pathname === link.to ? "page" : undefined}>
          <Sticker name={link.sticker} />
          {link.label}
        </Link>
      ))}
    </nav>
  );
};

// The frame of every screen: the top bar with the logo, one h1, the content, then the Pages nav: Home, Directory, Find help and
// Friends on pages that need a session, and Settings unless the screen is Settings itself. isWide lets a screen use the laptop's width.
export const ScreenFrame = (props: { title: string; children: ReactNode; hideSettingsLink?: boolean; isWide?: boolean }): ReactElement => {
  const location = useLocation();
  const hasAppLinks = showsAppLinks(location.pathname);
  const links = [...(hasAppLinks ? APP_LINKS : []), ...(props.hideSettingsLink === true ? [] : [SETTINGS_LINK])];
  const mainClass = ["screen", props.isWide === true ? "wide" : "", hasAppLinks ? "has-tabs" : ""].filter((part) => part !== "").join(" ");
  return (
    <>
      <header className="top-bar">
        <Link className="logo" to={hasAppLinks ? APP_PATHS.home : APP_PATHS.welcome}>
          <Sticker name="tags" />
          Meet First
        </Link>
      </header>
      <main className={mainClass}>
        <h1>{props.title}</h1>
        {props.children}
      </main>
      {links.length === 0 ? null : <PagesNav links={links} hasAppLinks={hasAppLinks} pathname={location.pathname} />}
    </>
  );
};

// Shows one ApiError: its sentence, plus a link to the start page when the session is missing (status 401).
export const ErrorNotice = (props: { error: ApiError }): ReactElement => {
  return (
    <div className="notice" role="alert">
      <p>{props.error.message}</p>
      {props.error.status === 401 ? <Link to={APP_PATHS.welcome}>Go to the start page</Link> : null}
    </div>
  );
};

// The words the copy button shows for each state.
const COPY_FAILED = "Copy failed. Select the text and copy it by hand.";

// Copies one text to the clipboard and says so for COPIED_MS; tells the person to copy by hand when the clipboard is missing or refuses.
export const CopyButton = (props: { text: string; label: string }): ReactElement => {
  const [status, setStatus] = useState<"rest" | "copied" | "failed">("rest");

  useEffect(() => {
    if (status !== "copied") return undefined;
    const timer = setTimeout(() => {
      setStatus("rest");
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const copy = async (): Promise<void> => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      setStatus("failed");
      return;
    }
    try {
      await clipboard.writeText(props.text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  const label = { rest: props.label, copied: "Copied", failed: COPY_FAILED }[status];
  return (
    <button type="button" className="quiet" onClick={() => void copy()}>
      {label}
    </button>
  );
};
