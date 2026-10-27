import { Component, useMemo, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { ContractError } from "@meet-first/contracts";
import { createAppRouter } from "./routes.js";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/shantell-sans";
import "./app.css";
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
          <button type="button" onClick={() => { window.location.reload(); }}>
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

// The whole app: an error boundary around the frame and the router.
export const AppRoot = (): ReactElement => {
  const router = useMemo(() => createAppRouter(), []);
  return (
    <AppErrorBoundary>
      <StickerSheet />
      <div className="app-frame">
        <RouterProvider router={router} />
      </div>
    </AppErrorBoundary>
  );
};

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new ContractError("root_element_missing", "The page has no root element. Rebuild the web app with pnpm --filter web build.");
}
createRoot(rootElement).render(<AppRoot />);
