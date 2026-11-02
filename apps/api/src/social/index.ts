// The social routes as one plugin for apps/api/src/server.ts slot 13 (wave 7): friend requests, a person's profile in Explore, and the
// orchestrator chat.
import type { RoutePlugin } from "../app-types.js";
import { registerAcceptFriendRequest, registerDeclineFriendRequest, registerListFriendRequests, registerSendFriendRequest } from "./friend-requests.js";
import { registerReadThread, registerRunPlan, registerSendToOrchestrator } from "./orchestrator.js";
import { registerReadProfile } from "./profile.js";

// The social routes for server.ts slot 13, in the order of routes.social: the requests list, send, accept, decline, a profile, the thread, send a message, run a plan.
export const registerSocialRoutes: RoutePlugin = (app, deps) => {
  registerListFriendRequests(app, deps);
  registerSendFriendRequest(app, deps);
  registerAcceptFriendRequest(app, deps);
  registerDeclineFriendRequest(app, deps);
  registerReadProfile(app, deps);
  registerReadThread(app, deps);
  registerSendToOrchestrator(app, deps);
  registerRunPlan(app, deps);
  return Promise.resolve();
};
