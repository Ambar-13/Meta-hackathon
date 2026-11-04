import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";

// Friend requests a person may send per UTC day.
export const FRIEND_REQUESTS_PER_DAY = 20;

// The body of POST /api/friend-requests: the listing of the person you want to be friends with. Only people in Explore can be asked.
export const FriendRequestCreate = z.object({ listingId: Uuid });
export type FriendRequestCreate = z.infer<typeof FriendRequestCreate>;

// What POST /api/friend-requests returns: the new request.
export const FriendRequestCreateResponse = z.object({ requestId: Uuid });
export type FriendRequestCreateResponse = z.infer<typeof FriendRequestCreateResponse>;

// Which way a pending request goes from the caller: one they received, or one they sent.
export const FriendRequestDirection = z.enum(["incoming", "outgoing"]);
export type FriendRequestDirection = z.infer<typeof FriendRequestDirection>;

// One pending request as the caller sees it: the other person's display name, and their listing when they are in Explore.
export const FriendRequestView = z.object({
  requestId: Uuid,
  direction: FriendRequestDirection,
  otherName: z.string(),
  otherListingId: Uuid.nullable(),
  createdAt: IsoTime,
});
export type FriendRequestView = z.infer<typeof FriendRequestView>;

// What GET /api/friend-requests returns: the caller's pending requests, received and sent, newest first.
export const FriendRequestsView = z.object({
  incoming: z.array(FriendRequestView),
  outgoing: z.array(FriendRequestView),
});
export type FriendRequestsView = z.infer<typeof FriendRequestsView>;

// What POST /api/friend-requests/:id/accept returns: the pair that now makes the two people friends, as an invite link does.
export const FriendRequestAcceptResponse = z.object({ pairId: Uuid });
export type FriendRequestAcceptResponse = z.infer<typeof FriendRequestAcceptResponse>;
