// The directory routes as one plugin for apps/api/src/server.ts slot 11: card sharing settings,
// browsing and joining the directory, the listed person's meetings, meetings with a listed persona,
// and the friends list.
import type { RoutePlugin } from "../app-types.js";
import { registerBrowse, registerFriends } from "./browse-and-friends.js";
import { registerReadSharing, registerUpdateSharing } from "./card-sharing.js";
import { registerCreateListingMeeting } from "./create-listing-meeting.js";
import {
  registerLeaveDirectory,
  registerListedMeetings,
  registerReadMyListing,
  registerUpsertMyListing,
} from "./my-listing.js";

// The directory routes for server.ts slot 11, in the order of routes.directory: sharing read and
// save, browse, your listing read, save and leave, your listed meetings, a meeting with a listed
// persona, friends.
export const registerDirectoryRoutes: RoutePlugin = (app, deps) => {
  registerReadSharing(app, deps);
  registerUpdateSharing(app, deps);
  registerBrowse(app, deps);
  registerReadMyListing(app, deps);
  registerUpsertMyListing(app, deps);
  registerLeaveDirectory(app, deps);
  registerListedMeetings(app, deps);
  registerCreateListingMeeting(app, deps);
  registerFriends(app, deps);
  return Promise.resolve();
};
