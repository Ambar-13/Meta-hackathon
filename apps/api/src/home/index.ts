// The home folder: GET /api/home, the signed-in person's card, meetings and pairs for the home screen, and Edit profile: their name and
// their photo (3 Nov 2026).
import type { RoutePlugin } from "../app-types.js";
import { registerProfileEdit } from "./profile-edit.js";
import { registerReadHome } from "./read-home.js";

// The home routes as one plugin for server.ts, registered after the sessions routes.
export const registerHomeRoutes: RoutePlugin = (app, deps) => {
  registerReadHome(app, deps);
  registerProfileEdit(app, deps);
  return Promise.resolve();
};
