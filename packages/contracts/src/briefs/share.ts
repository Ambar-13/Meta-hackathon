import { z } from "zod";
import { ItemKind } from "../cards/card.js";
import { QuestionKind } from "../meetings/meeting.js";
import { Side } from "../primitives.js";

// Keys a share page must never send, because they would reveal who the people are.
export const FORBIDDEN_SHARE_KEYS = ["person_id", "email", "pair_id"] as const;
// One supported brief point as the public page shows it: the text and its quotes, with no turn ids (share_read never returns ids).
const SharedPoint = z.object({
  text: z.string(),
  quotes: z
    .array(z.object({ text: z.string(), side: Side }))
    .min(1)
    .max(3),
});
// The public snapshot of a meeting. It is strict, so an extra key fails the build.
export const ShareSnapshot = z
  .object({
    question: z.string(),
    questionKind: QuestionKind,
    people: z.array(z.object({ side: Side, displayName: z.string() })).length(2),
    items: z.array(z.object({ side: Side, kind: ItemKind, claim: z.string(), quote: z.string() })),
    turns: z.array(
      z.object({
        side: Side,
        text: z.string(),
        claims: z.array(z.object({ text: z.string(), quote: z.string() })),
      }),
    ),
    brief: z.object({
      agree: z.array(SharedPoint),
      clash: z.array(SharedPoint),
      decideFirst: z.array(SharedPoint),
    }), // supported lines only
    comic: z.array(z.object({ caption: z.string(), imageUrl: z.string() })).optional(),
  })
  .strict();
export type ShareSnapshot = z.infer<typeof ShareSnapshot>;
// What the consent route returns: each side's consent, whether the page is live, and its slug once it is.
export const ConsentResponse = z.object({
  consentA: z.boolean(),
  consentB: z.boolean(),
  published: z.boolean(),
  slug: z.string().optional(),
});
export type ConsentResponse = z.infer<typeof ConsentResponse>;
// What withdrawing consent returns: the page is no longer published.
export const ConsentWithdrawResponse = z.object({ published: z.literal(false) });
export type ConsentWithdrawResponse = z.infer<typeof ConsentWithdrawResponse>;
// Random bytes in a share slug: 128 bits, which is 22 URL-safe base64 characters.
export const SHARE_SLUG_BYTES = 16;
