import type { RoutePlugin } from "../app-types.js";
import { registerApprove } from "./approve.js";
import { registerReadCard, registerReadItemSource } from "./read-card.js";
import { registerRequestBuild } from "./request-build.js";

// The card routes as one plugin for apps/api/src/server.ts slot 3 (seams S2): request a build, read a card, read an item's source message, approve it.
export const registerCardsRoutes: RoutePlugin = async (app, deps) => {
  await registerRequestBuild(app, deps);
  await registerReadCard(app, deps);
  await registerReadItemSource(app, deps);
  await registerApprove(app, deps);
};
