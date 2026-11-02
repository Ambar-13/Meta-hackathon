import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";

// Friend requests a person may send per UTC day (wave 7). Ambar's default; he can change it.
export const FRIEND_REQUESTS_PER_DAY = 20;

// The body of POST /api/friend-requests: the listing of the person you want to be friends with. Only people in Explore can be asked.
export const FriendRequestCreate = z.object({ listingId: Uuid });
// The type of FriendRequestCreate, read from the schema above.
export type FriendRequestCreate = z.infer<typeof FriendRequestCreate>;

// What POST /api/friend-requests returns: the new request.
export const FriendRequestCreateResponse = z.object({ requestId: Uuid });
// The type of FriendRequestCreateResponse, read from the schema above.
export type FriendRequestCreateResponse = z.infer<typeof FriendRequestCreateResponse>;

// Which way a pending request goes from the caller: one they received, or one they sent.
export const FriendRequestDirection = z.enum(["incoming", "outgoing"]);
// The type of FriendRequestDirection, read from the schema above.
export type FriendRequestDirection = z.infer<typeof FriendRequestDirection>;

// One pending request as the caller sees it: the other person's display name, and their listing when they are in Explore.
export const FriendRequestView = z.object({
  requestId: Uuid,
  direction: FriendRequestDirection,
  otherName: z.string(),
  otherListingId: Uuid.nullable(),
  createdAt: IsoTime,
});
// The type of FriendRequestView, read from the schema above.
export type FriendRequestView = z.infer<typeof FriendRequestView>;

// What GET /api/friend-requests returns: the caller's pending requests, received and sent, newest first.
export const FriendRequestsView = z.object({ incoming: z.array(FriendRequestView), outgoing: z.array(FriendRequestView) });
// The type of FriendRequestsView, read from the schema above.
export type FriendRequestsView = z.infer<typeof FriendRequestsView>;

// What POST /api/friend-requests/:id/accept returns: the pair that now makes the two people friends, as an invite link does.
export const FriendRequestAcceptResponse = z.object({ pairId: Uuid });
// The type of FriendRequestAcceptResponse, read from the schema above.
export type FriendRequestAcceptResponse = z.infer<typeof FriendRequestAcceptResponse>;
