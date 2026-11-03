import { z } from "zod";

// The kinds of point a summary holds, as the copy prompt names them; anything else the person's AI writes counts as other.
export const SUMMARY_KINDS = ["work", "value", "view", "habit", "style", "avoid", "change", "contradiction", "other"] as const;
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
