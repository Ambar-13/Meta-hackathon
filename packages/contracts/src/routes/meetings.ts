import { z } from "zod";
import { MeetingCreate, MeetingCreateResponse, MeetingReadyResponse, MeetingStartResponse, MeetingView, PairCreateResponse, PairJoin, PairJoinResponse, PairView, PollResponse } from "../meetings/index.js";

// Routes for pairs, meetings and the event stream.
// The events route answers with the poll shape when it has ?after=; the SSE form has no JSON body.
export const meetingsRoutes = {
  createPair: { method: "POST", path: "/api/pairs", request: z.undefined(), response: PairCreateResponse },
  joinPair: { method: "POST", path: "/api/pairs/join", request: PairJoin, response: PairJoinResponse },
  readPair: { method: "GET", path: "/api/pairs/:id", request: z.undefined(), response: PairView },
  createMeeting: { method: "POST", path: "/api/pairs/:id/meetings", request: MeetingCreate, response: MeetingCreateResponse },
  readMeeting: { method: "GET", path: "/api/meetings/:id", request: z.undefined(), response: MeetingView },
  ready: { method: "POST", path: "/api/meetings/:id/ready", request: z.undefined(), response: MeetingReadyResponse },
  start: { method: "POST", path: "/api/meetings/:id/start", request: z.undefined(), response: MeetingStartResponse },
  events: { method: "GET", path: "/api/meetings/:id/events", request: z.undefined(), response: PollResponse },
} as const;
