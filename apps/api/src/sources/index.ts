import type { RoutePlugin } from "../app-types.js";
import { registerUploadRoute } from "./upload.js";
import { registerReadSourceRoute } from "./read-source.js";
import { registerNamesReviewRoute } from "./names-review.js";

// The source routes as one plugin for apps/api/src/server.ts slot 2 (seams S2), in this order: upload, read with names, names review.
export const registerSourcesRoutes: RoutePlugin = (app, deps) => {
  registerUploadRoute(app, deps);
  registerReadSourceRoute(app, deps);
  registerNamesReviewRoute(app, deps);
  return Promise.resolve();
};
