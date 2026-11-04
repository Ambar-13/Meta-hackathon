import { z } from "zod";
import { QuestionKind } from "../meetings/meeting.js";
import { Side, Uuid } from "../primitives.js";

// A quote a brief line rests on, with the side it came from and whether it was found in the turn.
export const Quote = z.object({
  text: z.string(),
  side: Side,
  turnId: Uuid,
  verified: z.boolean(),
});
export type Quote = z.infer<typeof Quote>;
// One line of a brief, with up to three quotes. supported is null when the support judge could not decide.
export const BriefPoint = z.object({
  text: z.string(),
  quotes: z.array(Quote).min(1).max(3),
  supported: z.boolean().nullable(),
  supportReason: z.string().optional(),
});
export type BriefPoint = z.infer<typeof BriefPoint>;
// What GET /api/meetings/:id/brief returns: three agreements, three clashes and three things to decide first.
export const Brief = z.object({
  agree: z.array(BriefPoint).length(3),
  clash: z.array(BriefPoint).length(3),
  decideFirst: z.array(BriefPoint).length(3),
  supportRate: z.number().min(0).max(1).nullable(),
  supportReliable: z.boolean().nullable(),
  questionKind: QuestionKind,
});
export type Brief = z.infer<typeof Brief>;
// A quote as the brief model writes it, with its turn label.
const outputQuote = z.object({
  text: z.string().min(1).max(600),
  side: Side,
  turn_id: z.string().min(1),
});
// A brief line as the brief model writes it.
const outputPoint = z.object({
  text: z.string().min(1).max(300),
  quotes: z.array(outputQuote).min(1).max(3),
});
// What the brief model returns: three lines in each of the three groups (brief prompt).
export const BriefOutput = z.object({
  agree: z.array(outputPoint).length(3),
  clash: z.array(outputPoint).length(3),
  decide_first: z.array(outputPoint).length(3),
});
export type BriefOutput = z.infer<typeof BriefOutput>;
// What the support judge returns: one verdict for each of the nine lines, in index order.
export const BriefSupportJudgeOutput = z.object({
  lines: z
    .array(
      z.object({
        index: z.number().int().min(0).max(8),
        supported: z.boolean(),
        reason: z.string().min(1).max(200),
      }),
    )
    .length(9),
});
export type BriefSupportJudgeOutput = z.infer<typeof BriefSupportJudgeOutput>;
// The label shown when a line has a quote the judge did not support.
export const WEAK_RECEIPT_COPY = "weak quote";
// The label shown when a line has no quote at all.
export const NO_RECEIPT_COPY = "no quote";
// The three section headings of a brief for each kind of question. The data stays agree, clash and decideFirst; only the words
// change, so a get-along brief reads "where you'd click" and a deal reads "where you agree". The brief screen and the share page read it.
export const BRIEF_SECTION_LABELS: Record<
  QuestionKind,
  { agree: string; clash: string; decideFirst: string }
> = {
  get_along: {
    agree: "Where you'd click",
    clash: "Where you'd rub",
    decideFirst: "What to talk about first",
  },
  help: {
    agree: "Where help would work",
    clash: "Where it wouldn't",
    decideFirst: "What to ask first",
  },
  situation: {
    agree: "How you'd each probably react",
    clash: "Where you'd differ",
    decideFirst: "What to settle first",
  },
  decision: {
    agree: "Where you agree",
    clash: "Where you clash",
    decideFirst: "Decide this first",
  },
  deal: {
    agree: "Where a deal is likely",
    clash: "What blocks it",
    decideFirst: "What to offer first",
  },
  debate: {
    agree: "Where you agree",
    clash: "Where you split",
    decideFirst: "The strongest point on each side",
  },
  romance: {
    agree: "Where you'd click",
    clash: "Where you'd rub",
    decideFirst: "What to talk about first",
  },
};
