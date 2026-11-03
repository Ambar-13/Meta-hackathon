// The meeting routes as one plugin for apps/api/src/server.ts, slot 6: create, read, ready, start.
import type { RoutePlugin } from "../app-types.js";
import { registerCreateMeeting } from "./create-meeting.js";
import { registerReady } from "./ready.js";
import { registerReadMeeting } from "./read-meeting.js";
import { registerStart } from "./start.js";

// The meeting routes as one plugin for server.ts slot 6: create, read, ready, start.
export const registerMeetingsRoutes: RoutePlugin = (app, deps) => {
  registerCreateMeeting(app, deps);
  registerReadMeeting(app, deps);
  registerReady(app, deps);
  registerStart(app, deps);
  return Promise.resolve();
};
