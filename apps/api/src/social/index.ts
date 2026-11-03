// The social routes as one plugin for apps/api/src/server.ts slot 13: friend requests, a person's profile in Explore, the
// orchestrator chat, posts, and sharing posts and stories and liking posts.
import type { RoutePlugin } from "../app-types.js";
import { registerAcceptFriendRequest, registerDeclineFriendRequest, registerListFriendRequests, registerSendFriendRequest } from "./friend-requests.js";
import { registerReadThread, registerRunPlan, registerSendToOrchestrator } from "./orchestrator.js";
import { registerListFeed, registerListListingPosts, registerListMyPosts, registerListPosts, registerListStories } from "./posts.js";
import { registerReadProfile } from "./profile.js";
import { registerCreatePost, registerDeletePost, registerLikePost } from "./share-posts.js";

// The social routes for server.ts slot 13, in the order of routes.social: the requests list, send, accept, decline, a profile, the thread,
// send a message, run a plan, the posts of the feed, one profile's posts, share, delete, like and unlike, your own posts, the stories,
// and Home's feed a page at a time.
export const registerSocialRoutes: RoutePlugin = (app, deps) => {
  registerListFriendRequests(app, deps);
  registerSendFriendRequest(app, deps);
  registerAcceptFriendRequest(app, deps);
  registerDeclineFriendRequest(app, deps);
  registerReadProfile(app, deps);
  registerReadThread(app, deps);
  registerSendToOrchestrator(app, deps);
  registerRunPlan(app, deps);
  registerListPosts(app, deps);
  registerListListingPosts(app, deps);
  registerCreatePost(app, deps);
  registerDeletePost(app, deps);
  registerLikePost(app, deps);
  registerListMyPosts(app, deps);
  registerListStories(app, deps);
  registerListFeed(app, deps);
  return Promise.resolve();
};
