// The ask routes as one plugin for apps/api/src/server.ts slot 12: create an ask, list asks and the
// caller's copies, read one ask, and meet a helper from a help answer.
import type { RoutePlugin } from "../app-types.js";
import { registerCreateAsk } from "./create-ask.js";
import { registerMeetHelper } from "./meet-helper.js";
import { registerListAsks, registerReadAsk } from "./read-asks.js";

// The ask routes for server.ts slot 12, in this order: create, list, read, meet a helper.
export const registerAsksRoutes: RoutePlugin = (app, deps) => {
  registerCreateAsk(app, deps);
  registerListAsks(app, deps);
  registerReadAsk(app, deps);
  registerMeetHelper(app, deps);
  return Promise.resolve();
};
