// The summary folder: GET, PUT and DELETE /api/people/me/summary, the summary a person's own AI wrote about them.
import type { RoutePlugin } from "../app-types.js";
import { registerSummary } from "./summary-routes.js";

// The summary routes as one plugin for server.ts.
export const registerSummaryRoutes: RoutePlugin = (app, deps) => {
  registerSummary(app, deps);
  return Promise.resolve();
};
