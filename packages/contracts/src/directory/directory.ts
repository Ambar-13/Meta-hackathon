import { z } from "zod";
import { CARD_ITEMS_MAX, ItemKind } from "../cards/card.js";
import { MeetingState } from "../meetings/meeting.js";
import { IsoTime, PhotoKey, Uuid } from "../primitives.js";

// Most directory meetings one listed persona takes part in per UTC day.
export const DIRECTORY_MEETINGS_PER_LISTING_PER_DAY = 10;
// Longest line a person writes about themselves for their listing.
export const LISTING_LINE_MAX_CHARS = 140;
// Listings one directory page shows.
export const DIRECTORY_PAGE_SIZE = 20;
// The words next to the directory switch on the card screen. Off by default; turning it on is the consent to be met.
export const DIRECTORY_SWITCH_COPY = "List my Meety in Explore. Anyone in Explore can have their Meety meet yours, and your Meety may answer when someone asks for help in Explore, using only the items you mark public. You get every brief and every answer. You can leave at any time.";
// The words next to the dating switch on the card screen, under the directory switch. Off by default, and on only while listed.
export const ROMANCE_SWITCH_COPY = "Open to dating questions: people in Explore can ask my Meety how I would get on with them romantically. I get every brief.";
// The words next to the friends switch on the card screen. Off by default.
export const FRIENDS_ASK_SWITCH_COPY = "Let friends I've met here ask my Meety how I would probably react to something. I get a copy of every answer. I can turn this off at any time.";

// One public item as the directory shows it: its kind, claim and quote, and nothing else of the card or the notes.
export const PublicItem = z.object({ kind: ItemKind, claim: z.string(), quote: z.string() });
// The type of PublicItem, read from the schema above.
export type PublicItem = z.infer<typeof PublicItem>;
// One listing as anyone in the directory sees it: only listing fields, the sample mark and the face of a sample person, never a person
// id, a turn or an item that is not public.
export const DirectoryListing = z.object({ listingId: Uuid, displayName: z.string(), line: z.string(), openToRomance: z.boolean(), isSample: z.boolean(), items: z.array(PublicItem), photo: PhotoKey.nullable().optional() });
// The type of DirectoryListing, read from the schema above.
export type DirectoryListing = z.infer<typeof DirectoryListing>;
// What GET /api/directory returns: one page of listings, newest first or best match first when there is a query. The caller's own listing is left out.
export const DirectoryPage = z.object({ listings: z.array(DirectoryListing), page: z.number().int().min(0), hasMore: z.boolean() });
// The type of DirectoryPage, read from the schema above.
export type DirectoryPage = z.infer<typeof DirectoryPage>;
// The query of GET /api/directory: optional search words and a page number from 0.
export const DirectoryQuery = z.object({ query: z.string().trim().max(200).optional(), page: z.coerce.number().int().min(0).default(0) });
// The type of DirectoryQuery, read from the schema above.
export type DirectoryQuery = z.infer<typeof DirectoryQuery>;
// The caller's own listing, as GET /api/directory/me and PUT /api/directory/me return it.
export const MyListing = z.object({ listingId: Uuid, cardId: Uuid, line: z.string(), openToRomance: z.boolean(), items: z.array(PublicItem), createdAt: IsoTime });
// The type of MyListing, read from the schema above.
export type MyListing = z.infer<typeof MyListing>;
// The body of PUT /api/directory/me: join or change the listing, and the dating switch. The card must be the caller's, approved, with at
// least one public item.
export const ListingUpsert = z.object({ cardId: Uuid, line: z.string().trim().min(1).max(LISTING_LINE_MAX_CHARS), openToRomance: z.boolean() });
// The type of ListingUpsert, read from the schema above.
export type ListingUpsert = z.infer<typeof ListingUpsert>;
// One meeting a listed persona took part in, for the listed person's own list (GET /api/directory/me/meetings).
export const ListedMeeting = z.object({ meetingId: Uuid, otherDisplayName: z.string(), questionText: z.string(), state: MeetingState, createdAt: IsoTime });
// The type of ListedMeeting, read from the schema above.
export type ListedMeeting = z.infer<typeof ListedMeeting>;
// What GET /api/directory/me/meetings returns, newest first.
export const ListedMeetingsView = z.object({ meetings: z.array(ListedMeeting) });
// The type of ListedMeetingsView, read from the schema above.
export type ListedMeetingsView = z.infer<typeof ListedMeetingsView>;
// The sharing settings of one card (GET and PUT /api/cards/:id/sharing): the friends switch and the public items by position.
// Only approved, verified items may be public.
export const CardSharing = z.object({ friendsCanAsk: z.boolean(), publicPositions: z.array(z.number().int().min(1)).max(CARD_ITEMS_MAX) });
// The type of CardSharing, read from the schema above.
export type CardSharing = z.infer<typeof CardSharing>;
// One friend: a person the caller joined a pair with by invite or by an accepted friend request, named by that pair. canAsk is the friend's own switch;
// listingId is their listing when Explore shows it, so the friend links to their profile; isSample and photo mark a sample person and
// give their face (migration 0010).
export const Friend = z.object({ pairId: Uuid, displayName: z.string(), canAsk: z.boolean(), listingId: Uuid.nullable(), isSample: z.boolean().optional(), photo: PhotoKey.nullable().optional() });
// The type of Friend, read from the schema above.
export type Friend = z.infer<typeof Friend>;
// What GET /api/friends returns, most recently joined first.
export const FriendsView = z.object({ friends: z.array(Friend) });
// The type of FriendsView, read from the schema above.
export type FriendsView = z.infer<typeof FriendsView>;
