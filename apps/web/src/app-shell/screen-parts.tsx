import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "./api-fetch.js";
import { APP_PATHS } from "./app-paths.js";

// How long the copy button says Copied, 2 s [confirm] (no input gives this duration).
export const COPIED_MS = 2_000;
// The pages a visitor may open before they have a session: the start page, the claim page and the join page. The session cookie is
// HttpOnly, so the browser cannot tell whether a session exists, and the frame goes by the page instead [confirm].
const NO_SESSION_PATHS: readonly string[] = [APP_PATHS.welcome, APP_PATHS.claim, APP_PATHS.join];

// True on every page except the three above and the public share pages, which anyone with the link may open (design section 7).
function showsAppLinks(pathname: string): boolean {
  return !NO_SESSION_PATHS.includes(pathname) && !pathname.startsWith(APP_PATHS.sharePage(""));
}

// The links to the directory, the help finder and the friends list, in that order (design section 7).
const AppLinks = (): ReactElement => {
  return (
    <>
      <Link to={APP_PATHS.directory}>Directory</Link>
      <Link to={APP_PATHS.help}>Find help</Link>
      <Link to={APP_PATHS.friends}>Friends</Link>
    </>
  );
};

// The frame of every screen: one h1, the content, then a footer with Directory, Find help and Friends on pages that need a session,
// and Settings unless the screen is Settings itself.
export const ScreenFrame = (props: { title: string; children: ReactNode; hideSettingsLink?: boolean }): ReactElement => {
  const location = useLocation();
  const hasAppLinks = showsAppLinks(location.pathname);
  const hasSettingsLink = props.hideSettingsLink !== true;
  return (
    <main className="screen">
      <h1>{props.title}</h1>
      {props.children}
      {hasAppLinks || hasSettingsLink ? (
        <footer className="screen-footer">
          <nav className="actions" aria-label="Pages">
            {hasAppLinks ? <AppLinks /> : null}
            {hasSettingsLink ? <Link to={APP_PATHS.settings}>Settings</Link> : null}
          </nav>
        </footer>
      ) : null}
    </main>
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
