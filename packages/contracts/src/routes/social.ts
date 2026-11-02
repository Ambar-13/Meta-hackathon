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
  ProfileView,
} from "../social/index.js";

// Routes for friend requests, a person's profile in Explore, and the orchestrator chat (wave 7).
export const socialRoutes = {
  listFriendRequests: { method: "GET", path: "/api/friend-requests", request: z.undefined(), response: FriendRequestsView },
  sendFriendRequest: { method: "POST", path: "/api/friend-requests", request: FriendRequestCreate, response: FriendRequestCreateResponse },
  acceptFriendRequest: { method: "POST", path: "/api/friend-requests/:id/accept", request: z.undefined(), response: FriendRequestAcceptResponse },
  declineFriendRequest: { method: "POST", path: "/api/friend-requests/:id/decline", request: z.undefined(), response: z.undefined() },
  readProfile: { method: "GET", path: "/api/directory/:id", request: z.undefined(), response: ProfileView },
  readThread: { method: "GET", path: "/api/orchestrator", request: z.undefined(), response: OrchestratorThread },
  sendToOrchestrator: { method: "POST", path: "/api/orchestrator", request: OrchestratorSend, response: OrchestratorSendResponse },
  runPlan: { method: "POST", path: "/api/orchestrator/:id/run", request: z.undefined(), response: OrchestratorMessage },
} as const;
