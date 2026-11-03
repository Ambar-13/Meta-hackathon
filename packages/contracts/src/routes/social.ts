import { z } from "zod";
import {
  FriendRequestAcceptResponse,
  FriendRequestCreate,
  FriendRequestCreateResponse,
  FriendRequestsView,
  OrchestratorMessage,
  OrchestratorSend,
  OrchestratorSendResponse,
  OrchestratorThread,
  MyPostsView,
  PostCreate,
  PostCreated,
  PostLiked,
  PostsView,
  ProfileView,
  StoriesView,
} from "../social/index.js";

// Routes for friend requests, a person's profile in Explore, the orchestrator chat (wave 7), and posts (migration 0009); since 3 Nov 2026
// anyone shares posts and stories, likes posts, and reads their own posts and the stories (migration 0013).
export const socialRoutes = {
  listFriendRequests: { method: "GET", path: "/api/friend-requests", request: z.undefined(), response: FriendRequestsView },
  sendFriendRequest: { method: "POST", path: "/api/friend-requests", request: FriendRequestCreate, response: FriendRequestCreateResponse },
  acceptFriendRequest: { method: "POST", path: "/api/friend-requests/:id/accept", request: z.undefined(), response: FriendRequestAcceptResponse },
  declineFriendRequest: { method: "POST", path: "/api/friend-requests/:id/decline", request: z.undefined(), response: z.undefined() },
  readProfile: { method: "GET", path: "/api/directory/:id", request: z.undefined(), response: ProfileView },
  readThread: { method: "GET", path: "/api/orchestrator", request: z.undefined(), response: OrchestratorThread },
  sendToOrchestrator: { method: "POST", path: "/api/orchestrator", request: OrchestratorSend, response: OrchestratorSendResponse },
  runPlan: { method: "POST", path: "/api/orchestrator/:id/run", request: z.undefined(), response: OrchestratorMessage },
  listPosts: { method: "GET", path: "/api/posts", request: z.undefined(), response: PostsView },
  listListingPosts: { method: "GET", path: "/api/directory/:id/posts", request: z.undefined(), response: PostsView },
  createPost: { method: "POST", path: "/api/posts", request: PostCreate, response: PostCreated },
  deletePost: { method: "DELETE", path: "/api/posts/:id", request: z.undefined(), response: z.undefined() },
  likePost: { method: "PUT", path: "/api/posts/:id/like", request: z.undefined(), response: PostLiked },
  unlikePost: { method: "DELETE", path: "/api/posts/:id/like", request: z.undefined(), response: PostLiked },
  listMyPosts: { method: "GET", path: "/api/people/me/posts", request: z.undefined(), response: MyPostsView },
  listStories: { method: "GET", path: "/api/stories", request: z.undefined(), response: StoriesView },
} as const;
