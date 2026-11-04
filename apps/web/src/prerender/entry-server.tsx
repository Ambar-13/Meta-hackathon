import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router-dom/server.js";
import { AppTree } from "../app-shell/app-tree.js";
import { APP_ROUTES } from "../app-shell/routes.js";

// The host the static router sees. It never reaches a network: the routes have no loaders, and the
// host name cannot resolve.
const PRERENDER_ORIGIN = "http://prerender.invalid";

// The page at one client path as HTML, rendered at build time by apps/web/prerender.ts: the same
// tree the browser renders, around a static router at that path, so that when the browser hydrates
// the page it finds the markup it expects. Throws when the path answers a redirect instead of a page.
export async function renderPath(path: string): Promise<string> {
  const handler = createStaticHandler(APP_ROUTES);
  const context = await handler.query(new Request(new URL(path, PRERENDER_ORIGIN)));
  if (context instanceof Response) {
    throw new Error(`Rendering ${path} gave a redirect or a response, not a page.`);
  }
  // The same route table the handler matched, so the ids in the context line up.
  const router = createStaticRouter(APP_ROUTES, context);
  const tree: ReactElement = (
    <AppTree>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </AppTree>
  );
  return renderToString(tree);
}
