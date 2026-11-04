import { Component, type ReactElement, type ReactNode } from "react";
import { StickerSheet } from "../look/index.js";

// Catches a screen that throws and shows a reload button instead of a blank page.
class AppErrorBoundary extends Component<{ children: ReactNode }, { hasFailed: boolean }> {
  override state = { hasFailed: false };

  static getDerivedStateFromError(): { hasFailed: boolean } {
    return { hasFailed: true };
  }

  override render(): ReactNode {
    if (this.state.hasFailed) {
      return (
        <main className="screen">
          <p>Something on this screen broke. Reload the page to try again.</p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

// Everything around the router: the error boundary, the sticker sheet and the app frame. The
// browser renders it around RouterProvider (start-app.tsx), and the build renders the same tree
// around a static router (prerender/entry-server.tsx), so the HTML the server sends for a public
// page and the HTML the browser hydrates are the same.
export const AppTree = (props: { children: ReactNode }): ReactElement => {
  return (
    <AppErrorBoundary>
      <StickerSheet />
      <div className="app-frame">{props.children}</div>
    </AppErrorBoundary>
  );
};
