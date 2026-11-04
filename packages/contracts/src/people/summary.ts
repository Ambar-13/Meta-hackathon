import { z } from "zod";

// The kinds of point a summary holds, as the copy prompt names them; anything else the person's AI writes counts as other.
export const SUMMARY_KINDS = [
  "work",
  "value",
  "view",
  "habit",
  "style",
  "avoid",
  "change",
  "contradiction",
  "other",
] as const;
// One kind of summary point.
export const SummaryKind = z.enum(SUMMARY_KINDS);
// The type of SummaryKind, read from the schema above.
export type SummaryKind = z.infer<typeof SummaryKind>;
// How strongly the person holds a point, as their AI judged it.
export const SummaryStrength = z.enum(["strong", "moderate", "mild"]);
// The type of SummaryStrength, read from the schema above.
export type SummaryStrength = z.infer<typeof SummaryStrength>;

// Most points a summary keeps; the rest are dropped.
export const SUMMARY_MAX_POINTS = 80;
// Most quotes one point keeps.
export const SUMMARY_QUOTES_MAX = 3;
// Longest topic, in characters.
export const SUMMARY_TOPIC_MAX_CHARS = 60;
// Longest point, and longest quote, in characters.
export const SUMMARY_LINE_MAX_CHARS = 300;

// One point of a person's summary: its kind, its topic, the point in words, how strongly it is held, and up to three quotes
// the person's AI gave for it. The quotes are the AI's claims until a check finds them in the person's own messages.
export const SummaryPoint = z.object({
  kind: SummaryKind,
  topic: z.string().max(SUMMARY_TOPIC_MAX_CHARS),
  point: z.string().min(1).max(SUMMARY_LINE_MAX_CHARS),
  strength: SummaryStrength,
  quotes: z.array(z.string().min(1).max(SUMMARY_LINE_MAX_CHARS)).max(SUMMARY_QUOTES_MAX),
});
// The type of SummaryPoint, read from the schema above.
export type SummaryPoint = z.infer<typeof SummaryPoint>;

// Longest summary a person may paste, in characters.
export const SUMMARY_MAX_CHARS = 20_000;
// Most times a person may save their summary in one UTC day; each save runs one names check.
export const SUMMARY_SAVES_PER_DAY = 10;

// Where one point's quote was found: the quote as it stands in the person's own message, that message's index in its upload, and
// its id, since indexes repeat across uploads.
export const SummaryFound = z.object({
  quote: z.string().min(1),
  turnIndex: z.number().int().min(0),
  turnId: z.string().uuid(),
});
// The type of SummaryFound, read from the schema above.
export type SummaryFound = z.infer<typeof SummaryFound>;
// One point as the person sees it: the point, and where its quote was found in their messages, or null when it was not.
export const SummaryPointView = SummaryPoint.extend({ found: SummaryFound.nullable() });
// The type of SummaryPointView, read from the schema above.
export type SummaryPointView = z.infer<typeof SummaryPointView>;
// A person's summary as they see it: checking until the names check and the quote lookups finish, then ready (or failed), with its
// points, whether friends' asks may use it, and when it was last saved.
export const SummaryView = z.object({
  state: z.enum(["checking", "ready", "failed"]),
  points: z.array(SummaryPointView),
  friendsCanAsk: z.boolean(),
  updatedAt: z.string(),
});
// The type of SummaryView, read from the schema above.
export type SummaryView = z.infer<typeof SummaryView>;
// The body of PUT /api/people/me/summary: the pasted text, trimmed and not empty, and whether friends' asks may use it.
export const SummarySave = z.object({
  text: z.string().trim().min(1).max(SUMMARY_MAX_CHARS),
  friendsCanAsk: z.boolean(),
});
// The type of SummarySave, read from the schema above.
export type SummarySave = z.infer<typeof SummarySave>;
