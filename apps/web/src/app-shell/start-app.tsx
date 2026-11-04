import { useEffect, useMemo, type ReactElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { ContractError } from "@meet-first/contracts";
import { recordPageViews } from "./analytics.js";
import { AppTree } from "./app-tree.js";
import { canHydrate } from "./hydration.js";
import { createAppRouter } from "./routes.js";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/shantell-sans";
import "./app.css";
import "./app-look.css";

// The whole app: the tree around the browser router, with a page view for each page.
export const AppRoot = (): ReactElement => {
  const router = useMemo(() => createAppRouter(), []);
  useEffect(() => recordPageViews(router), [router]);
  return (
    <AppTree>
      <RouterProvider router={router} />
    </AppTree>
  );
};

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new ContractError(
    "root_element_missing",
    "The page has no root element. Rebuild the web app with pnpm --filter web build.",
  );
}
// A public page arrives with its words already in the root (apps/web/prerender.ts), so at its bare
// address the app takes over that markup. With a query or a fragment the first render differs from
// that markup (an access code fills a field, a sign-in result adds a line), and every other page
// arrives as the empty shell; those are rendered from nothing.
if (rootElement.hasChildNodes() && canHydrate(window.location.search, window.location.hash)) {
  hydrateRoot(rootElement, <AppRoot />);
} else {
  rootElement.replaceChildren();
  createRoot(rootElement).render(<AppRoot />);
}
