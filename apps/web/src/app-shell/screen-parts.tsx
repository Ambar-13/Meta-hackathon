import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "./api-fetch.js";
import { APP_PATHS } from "./app-paths.js";
import { SocialRail } from "./social-rail.js";
import { Icon, Sticker } from "../look/index.js";

// How long the copy button says Copied, 2 s [confirm] (no input gives this duration).
export const COPIED_MS = 2_000;
// The pages a visitor may open before they have a session: the start page, the claim page and the join page. The session cookie is
// HttpOnly, so the browser cannot tell whether a session exists, and the frame goes by the page instead [confirm].
const NO_SESSION_PATHS: readonly string[] = [APP_PATHS.welcome, APP_PATHS.claim, APP_PATHS.join];

// True on every page except the three above and the public share pages, which anyone with the link may open (design section 7).
function showsAppLinks(pathname: string): boolean {
  return !NO_SESSION_PATHS.includes(pathname) && !pathname.startsWith(APP_PATHS.sharePage(""));
}

// The Settings link, the one link in the Pages nav of a page without a session.
const SETTINGS_LINK = { label: "Settings", to: APP_PATHS.settings } as const;

// The frame of a page without a session, as it was before wave 7: the top bar with the logo, the content, and Settings as one chip.
const OpenFrame = (props: { main: ReactElement; hasSettingsLink: boolean; pathname: string }): ReactElement => {
  return (
    <>
      <header className="top-bar">
        <Link className="logo" to={APP_PATHS.welcome}>
          <Sticker name="tags" />
          Meet First
        </Link>
      </header>
      {props.main}
      {props.hasSettingsLink ? (
        <nav className="top-links" aria-label="Pages">
          <Link to={SETTINGS_LINK.to} aria-current={props.pathname === SETTINGS_LINK.to ? "page" : undefined}>
            <Sticker name="gear" />
            {SETTINGS_LINK.label}
          </Link>
        </nav>
      ) : null}
    </>
  );
};

// The frame of a signed-in page: the phone's top bar as Instagram's, Invite a friend at its left end, the logo in the middle and Settings
// at its right end (Ambar, 3 Nov 2026: "like instagram you had the logo centred"), then the rail or tab bar and the content column.
const SignedInFrame = (props: { main: ReactElement; hasSettingsLink: boolean; pathname: string }): ReactElement => {
  return (
    <div className="social-frame">
      <header className="top-bar social-top">
        <Link className="top-invite" to={APP_PATHS.pair} aria-label="Invite a friend">
          <Icon name="invite" size={24} />
        </Link>
        <Link className="logo" to={APP_PATHS.home}>
          <Sticker name="tags" />
          Meet First
        </Link>
        {props.hasSettingsLink ? (
          <Link className="top-settings" to={SETTINGS_LINK.to} aria-label={SETTINGS_LINK.label}>
            <Icon name="settings" size={24} />
          </Link>
        ) : null}
      </header>
      <SocialRail pathname={props.pathname} hasSettingsLink={props.hasSettingsLink} />
      <div className="social-body">{props.main}</div>
    </div>
  );
};

// What a screen passes to the frame: one h1 title (or hasOwnHeading when the screen draws its own h1), the content, and its options.
// isWide lets a screen use the laptop's width; titleAside sits beside the h1, for a name tag or a status.
type FrameProps = { title: string; children: ReactNode; hideSettingsLink?: boolean; isWide?: boolean; titleAside?: ReactNode; hasOwnHeading?: boolean };

// The h1 of a screen, with the aside beside it when there is one.
const FrameTitle = (props: FrameProps): ReactElement | null => {
  if (props.hasOwnHeading === true) return null;
  if (props.titleAside === undefined) return <h1>{props.title}</h1>;
  return (
    <div className="screen-title">
      <h1>{props.title}</h1>
      {props.titleAside}
    </div>
  );
};

// The frame of every screen. A signed-in page gets the rail on a laptop and the tab bar on a phone (Chat, Explore, Friends, Me, and
// Settings unless the screen is Settings itself). The start, claim and join pages and the public share pages keep the plain frame.
export const ScreenFrame = (props: FrameProps): ReactElement => {
  const location = useLocation();
  const hasAppLinks = showsAppLinks(location.pathname);
  const hasSettingsLink = props.hideSettingsLink !== true;
  const mainClass = ["screen", props.isWide === true ? "wide" : "", hasAppLinks ? "has-tabs" : ""].filter((part) => part !== "").join(" ");
  const main = (
    <main className={mainClass}>
      <FrameTitle {...props} />
      {props.children}
    </main>
  );
  if (!hasAppLinks) return <OpenFrame main={main} hasSettingsLink={hasSettingsLink} pathname={location.pathname} />;
  return <SignedInFrame main={main} hasSettingsLink={hasSettingsLink} pathname={location.pathname} />;
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
