import { z } from "zod";
import { IsoTime, PhotoKey, Uuid } from "../primitives.js";
import { CardState, ItemKind } from "../cards/card.js";
import { MeetingState, QuestionKind } from "../meetings/meeting.js";

// Meetings and pairs the home screen lists, newest first, 10 each (the design pass gives no
// number).
export const HOME_LIST_MAX = 10;
// Card items the home screen shows on the person's name tag, 3.
export const HOME_CARD_ITEMS_MAX = 3;

// The person's newest upload: its id and whether the names check has written its result.
export const HomeSource = z.object({
  id: Uuid,
  namesPassDone: z.boolean(),
  namesReviewed: z.boolean(),
});
export type HomeSource = z.infer<typeof HomeSource>;

// One item on the home name tag: its kind, its one-line claim and the quote it rests on.
export const HomeCardItem = z.object({ kind: ItemKind, claim: z.string(), quote: z.string() });
export type HomeCardItem = z.infer<typeof HomeCardItem>;

// The person's newest card: its id, state, how many items it has, and its first approved items (all
// items while it is not approved).
export const HomeCard = z.object({
  id: Uuid,
  state: CardState,
  itemCount: z.number().int().min(0),
  items: z.array(HomeCardItem).max(HOME_CARD_ITEMS_MAX),
});
export type HomeCard = z.infer<typeof HomeCard>;

// One meeting the person is a member of: the question, its kind, where it is, the other person's
// display name, and whether this person's brief is written.
export const HomeMeetingRow = z.object({
  id: Uuid,
  questionText: z.string(),
  questionKind: QuestionKind,
  state: MeetingState,
  otherDisplayName: z.string(),
  isBriefReady: z.boolean(),
  createdAt: IsoTime,
});
export type HomeMeetingRow = z.infer<typeof HomeMeetingRow>;

// One pair the person made or joined that has not expired: who else is in it, if anyone, and when
// it expires.
export const HomePairRow = z.object({
  id: Uuid,
  otherDisplayName: z.string().nullable(), // null while nobody has joined
  createdAt: IsoTime,
  expiresAt: IsoTime,
});
export type HomePairRow = z.infer<typeof HomePairRow>;

// What GET /api/home returns: everything the home screen shows to the signed-in person, and nothing
// about anyone else beyond the display names already shown in their pairs and meetings.
export const HomeView = z.object({
  displayName: z.string(),
  // The person's own profile photo, when they put one up.
  photo: PhotoKey.nullable().optional(),
  source: HomeSource.nullable(),
  card: HomeCard.nullable(),
  meetings: z.array(HomeMeetingRow).max(HOME_LIST_MAX), // newest first, by createdAt
  pairs: z.array(HomePairRow).max(HOME_LIST_MAX), // newest first, by createdAt; expired pairs are left out
  serverNow: IsoTime,
});
export type HomeView = z.infer<typeof HomeView>;
