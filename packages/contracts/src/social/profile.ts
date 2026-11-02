import { z } from "zod";
import { PublicItem } from "../directory/directory.js";
import { Uuid } from "../primitives.js";

// How the caller stands with the person behind a profile: it is them, friends, a request they sent, a request they received, or none.
export const Friendship = z.enum(["self", "friends", "requested", "incoming", "none"]);
// The type of Friendship, read from the schema above.
export type Friendship = z.infer<typeof Friendship>;

// What GET /api/directory/:id returns: one person in Explore as the caller sees them. requestId is set for requested and incoming,
// pairId for friends; canAsk says whether that friend lets friends ask their agent; isSample marks a sample person (migration 0009).
export const ProfileView = z.object({
  listingId: Uuid,
  displayName: z.string(),
  line: z.string(),
  openToRomance: z.boolean(),
  isSample: z.boolean(),
  items: z.array(PublicItem),
  friendship: Friendship,
  requestId: Uuid.nullable(),
  pairId: Uuid.nullable(),
  canAsk: z.boolean(),
});
// The type of ProfileView, read from the schema above.
export type ProfileView = z.infer<typeof ProfileView>;
