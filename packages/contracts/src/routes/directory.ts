import { z } from "zod";
import { AnswerMeetingCreate, AskCreate, AskCreateResponse, AsksView, AskView, CardSharing, DirectoryPage, FriendsView, ListedMeetingsView, ListingUpsert, MyListing } from "../directory/index.js";
import { MeetingCreate, MeetingCreateResponse } from "../meetings/index.js";

// Routes for the directory, a card's sharing settings and the friends list.
export const directoryRoutes = {
  readSharing: { method: "GET", path: "/api/cards/:id/sharing", request: z.undefined(), response: CardSharing },
  updateSharing: { method: "PUT", path: "/api/cards/:id/sharing", request: CardSharing, response: CardSharing },
  browse: { method: "GET", path: "/api/directory", request: z.undefined(), response: DirectoryPage },
  readMyListing: { method: "GET", path: "/api/directory/me", request: z.undefined(), response: MyListing },
  upsertMyListing: { method: "PUT", path: "/api/directory/me", request: ListingUpsert, response: MyListing },
  leave: { method: "DELETE", path: "/api/directory/me", request: z.undefined(), response: z.undefined() },
  listedMeetings: { method: "GET", path: "/api/directory/me/meetings", request: z.undefined(), response: ListedMeetingsView },
  createListingMeeting: { method: "POST", path: "/api/directory/:id/meetings", request: MeetingCreate, response: MeetingCreateResponse },
  friends: { method: "GET", path: "/api/friends", request: z.undefined(), response: FriendsView },
} as const;
// Routes for asks: help searches and friend asks.
export const asksRoutes = {
  createAsk: { method: "POST", path: "/api/asks", request: AskCreate, response: AskCreateResponse },
  readAsk: { method: "GET", path: "/api/asks/:id", request: z.undefined(), response: AskView },
  listAsks: { method: "GET", path: "/api/asks", request: z.undefined(), response: AsksView },
  meetHelper: { method: "POST", path: "/api/asks/:id/answers/:answerId/meeting", request: AnswerMeetingCreate, response: MeetingCreateResponse },
} as const;
