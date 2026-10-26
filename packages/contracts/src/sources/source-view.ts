import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";
import { Category } from "./scrub-categories.js";
import { SourceKind } from "./turn.js";

// Names shown on each page of the names review (R2.4).
export const NAMES_PAGE_SIZE = 20;
// One row of the names review: a name, its role token, the words around it and whether to keep it.
export const NameRow = z.object({
  text: z.string(),
  roleToken: z.string(),
  context: z.string(),
  keep: z.boolean(),
});
// The type of NameRow, read from the schema above.
export type NameRow = z.infer<typeof NameRow>;
// What GET /api/sources/:id returns: the counts, the review state and one page of names.
export const SourceView = z.object({
  id: Uuid,
  kind: SourceKind,
  turnCount: z.number().int(),
  redactionCount: z.number().int(),
  personaSignal: z.number(),
  namesPassDone: z.boolean(), // true once the names pass has written its result; the review is refused before that
  namesReviewedAt: IsoTime.nullable(),
  frozenAt: IsoTime.nullable(),
  names: z.object({
    page: z.number().int().min(1),
    pageSize: z.literal(NAMES_PAGE_SIZE),
    total: z.number().int(),
    rows: z.array(NameRow),
  }),
  serverNow: IsoTime,
});
// The type of SourceView, read from the schema above.
export type SourceView = z.infer<typeof SourceView>;
// The person's answers in the names review, sent to POST /api/sources/:id/names-review.
// The 10,000 bound on decisions is a parse bound picked here [confirm].
export const NamesReview = z.object({
  decisions: z.array(z.object({ text: z.string().min(1), keep: z.boolean() })).max(10_000),
  sensitiveOptIn: z.array(Category),
});
// The type of NamesReview, read from the schema above.
export type NamesReview = z.infer<typeof NamesReview>;
// What the names review returns once the source is frozen (D16).
export const NamesReviewResponse = z.object({ frozenAt: IsoTime, redactionCount: z.number().int() });
// The type of NamesReviewResponse, read from the schema above.
export type NamesReviewResponse = z.infer<typeof NamesReviewResponse>;
