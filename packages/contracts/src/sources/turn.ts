import { z } from "zod";
import { Category } from "./scrub-categories.js";

// Longest text one turn may hold, in characters.
export const TURN_TEXT_MAX_CHARS = 20_000;
// Most turns one source may hold.
export const TURNS_PER_SOURCE_MAX = 10_000;
// Most canonical text one source may hold: 2 MiB.
export const CANONICAL_TEXT_MAX_BYTES = 2_097_152;
// Most decoded bytes one upload may hold: 20 MiB.
export const UPLOAD_DECODED_MAX_BYTES = 20_971_520;
// Most compressed bytes one upload may hold: 8 MiB.
export const UPLOAD_COMPRESSED_MAX_BYTES = 8_388_608;
// Body limit of the upload route: 21 MiB.
export const UPLOAD_BODY_LIMIT_BYTES = 22_020_096;
// Sources one person may keep.
export const SOURCES_PER_PERSON_MAX = 3;
// Below this persona signal the source is too thin to use.
export const PERSONA_SIGNAL_LOW = 0.15;
// Where a source came from.
export const SourceKind = z.enum(["chatgpt", "claude", "notes", "paste"]);
export type SourceKind = z.infer<typeof SourceKind>;
// One of the person's own messages, as it arrives in the NDJSON body.
export const Turn = z.object({
  turnIndex: z.number().int().min(0),
  role: z.literal("user"),
  text: z.string().min(1).max(TURN_TEXT_MAX_CHARS),
  lang: z.string().min(2).max(35).optional(),
  sensitiveCategories: z.array(Category),
});
export type Turn = z.infer<typeof Turn>;
// The first line of an upload: where the turns came from and which rules cleaned them.
export const SourceHeader = z.object({
  kind: SourceKind,
  parserVersion: z.string().min(1),
  scrubVersion: z.string().min(1),
  personaSignal: z.number().min(0).max(1),
  attested: z.literal(true),
  turnCount: z.number().int().min(1).max(TURNS_PER_SOURCE_MAX),
});
export type SourceHeader = z.infer<typeof SourceHeader>;
// What POST /api/sources returns. A repeat upload returns the first id with duplicate set.
export const SourceCreateResponse = z.object({
  sourceId: z.string().uuid(),
  turnCount: z.number().int(),
  redactionCount: z.number().int(),
  duplicate: z.boolean(),
});
export type SourceCreateResponse = z.infer<typeof SourceCreateResponse>;
