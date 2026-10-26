import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "./api-fetch.js";
import { APP_PATHS } from "./app-paths.js";

// How long the copy button says Copied, 2 s [confirm] (no input gives this duration).
export const COPIED_MS = 2_000;

// The frame of every screen: one h1, the content, and a footer link to Settings unless the screen is Settings itself.
export const ScreenFrame = (props: { title: string; children: ReactNode; hideSettingsLink?: boolean }): ReactElement => {
  return (
    <main className="screen">
      <h1>{props.title}</h1>
      {props.children}
      {props.hideSettingsLink === true ? null : (
        <footer className="screen-footer">
          <Link to={APP_PATHS.settings}>Settings</Link>
        </footer>
      )}
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
