// The comic routes as one plugin for apps/api/src/server.ts slot 9 (seams S2): request a comic, read it, and read a panel image.
import type { RoutePlugin } from "../app-types.js";
import { registerPanelImage } from "./panel-image.js";
import { registerReadComic } from "./read-comic.js";
import { registerRequestComic } from "./request-comic.js";

// The comic routes: POST the request, GET the comic view, GET one panel's webp.
export const registerComicsRoutes: RoutePlugin = async (app, deps) => {
  await registerRequestComic(app, deps);
  await registerReadComic(app, deps);
  await registerPanelImage(app, deps);
};
