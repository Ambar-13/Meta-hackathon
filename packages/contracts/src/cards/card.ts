import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";

// Fewest items a card may hold.
export const CARD_ITEMS_MIN = 6;
// Most items a card may hold.
export const CARD_ITEMS_MAX = 40;
// Most characters the card prompt may take from the sources.
export const CARD_INPUT_MAX_CHARS = 600_000;
// Cards one source may build per day.
export const CARDS_PER_SOURCE_PER_DAY = 2;
// How often the browser polls a building card, in milliseconds.
export const CARD_POLL_MS = 3_000;
// The kinds of item a card may hold.
export const ItemKind = z.enum(["value", "preference", "habit", "boundary", "goal"]);
// The type of ItemKind, read from the schema above.
export type ItemKind = z.infer<typeof ItemKind>;
// Where a card is in its life: building, ready, thin, failed or approved.
export const CardState = z.enum(["building", "ready", "thin", "failed", "approved"]);
// The type of CardState, read from the schema above.
export type CardState = z.infer<typeof CardState>;
// One item of a card as the browser sees it, with the quote it rests on.
export const CardItem = z.object({
  id: Uuid,
  position: z.number().int().min(1),
  kind: ItemKind,
  claim: z.string(),
  lang: z.string(),
  gloss: z.string(),
  turnId: Uuid,
  quote: z.string(),
  verified: z.boolean(),
  flagged: z.boolean(),
  approved: z.boolean(),
  sensitive: z.boolean(),
});
// The type of CardItem, read from the schema above.
export type CardItem = z.infer<typeof CardItem>;
// The source message of one card item, for its owner's card screen: tapping a quote shows the message it came from
// with the quote marked. highlight is the quote's range in text, found through the receipts offset map, or null
// when the quote is not in the message (a flagged item). Only the card's owner reads this. A meeting citation shows the
// quote alone, because approving an item lets the persona quote it, not show the whole message.
export const CardItemSource = z.object({
  turnIndex: z.number().int(),
  text: z.string(),
  highlight: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).nullable(),
});
// The type of CardItemSource, read from the schema above.
export type CardItemSource = z.infer<typeof CardItemSource>;
// What GET /api/cards/:id returns.
export const CardView = z.object({
  id: Uuid,
  sourceId: Uuid,
  state: CardState,
  thin: z.boolean(),
  recallAllowed: z.boolean(),
  itemsTotal: z.number().int().nullable(),
  itemsVerified: z.number().int().nullable(),
  items: z.array(CardItem),
  builtAt: IsoTime.nullable(),
  serverNow: IsoTime,
});
// The type of CardView, read from the schema above.
export type CardView = z.infer<typeof CardView>;
// The body of POST /api/cards/:id/approve: the items the person keeps and the recall switch.
export const CardApprove = z.object({ itemIds: z.array(Uuid).max(CARD_ITEMS_MAX), recallAllowed: z.boolean() });
// The type of CardApprove, read from the schema above.
export type CardApprove = z.infer<typeof CardApprove>;
// What approving a card returns.
export const CardApproveResponse = z.object({ state: z.literal("approved") });
// The type of CardApproveResponse, read from the schema above.
export type CardApproveResponse = z.infer<typeof CardApproveResponse>;
// What POST /api/sources/:id/cards returns: the id of the card that is building.
export const CardRequestResponse = z.object({ cardId: Uuid });
// The type of CardRequestResponse, read from the schema above.
export type CardRequestResponse = z.infer<typeof CardRequestResponse>;
// The words shown next to the recall switch, kept word for word.
export const RECALL_SWITCH_COPY = "Let my Meety search my notes during meetings, with names hidden and secrets removed. The other person may see quotes from them.";
// What the card model returns: items with a kind, a claim, a language, a gloss, a turn label and a quote.
// The per-field maximums bound parsing and are picked here.
export const CardBuildOutput = z.object({
  items: z
    .array(
      z.object({
        kind: ItemKind,
        claim: z.string().min(1).max(300),
        lang: z.string().min(2).max(35),
        gloss: z.string().min(1).max(300),
        turn_id: z.string().min(1),
        quote: z.string().min(1).max(600),
      }),
    )
    .min(CARD_ITEMS_MIN)
    .max(CARD_ITEMS_MAX),
});
// The type of CardBuildOutput, read from the schema above.
export type CardBuildOutput = z.infer<typeof CardBuildOutput>;
