import { z } from "zod";
import { Category } from "./scrub-categories.js";

// Longest text one turn may hold, in characters (D5).
export const TURN_TEXT_MAX_CHARS = 20_000;
// Most turns one source may hold (D5).
export const TURNS_PER_SOURCE_MAX = 10_000;
// Most canonical text one source may hold: 2 MiB (D5).
export const CANONICAL_TEXT_MAX_BYTES = 2_097_152;
// Most decoded bytes one upload may hold: 20 MiB (D4).
export const UPLOAD_DECODED_MAX_BYTES = 20_971_520;
// Most compressed bytes one upload may hold: 8 MiB (D4).
export const UPLOAD_COMPRESSED_MAX_BYTES = 8_388_608;
// Body limit of the upload route: 21 MiB (D4).
export const UPLOAD_BODY_LIMIT_BYTES = 22_020_096;
// Sources one person may keep (D60).
export const SOURCES_PER_PERSON_MAX = 3;
// Below this persona signal the source is too thin to use (R3.8).
export const PERSONA_SIGNAL_LOW = 0.15;
// Where a source came from (D10).
export const SourceKind = z.enum(["chatgpt", "claude", "notes", "paste"]);
// The type of SourceKind, read from the schema above.
export type SourceKind = z.infer<typeof SourceKind>;
// One of the person's own messages, as it arrives in the NDJSON body (IMPLEMENTATION.md 2.1).
export const Turn = z.object({
  turnIndex: z.number().int().min(0),
  role: z.literal("user"),
  text: z.string().min(1).max(TURN_TEXT_MAX_CHARS),
  lang: z.string().min(2).max(35).optional(),
  sensitiveCategories: z.array(Category),
});
// The type of Turn, read from the schema above.
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
// The type of SourceHeader, read from the schema above.
export type SourceHeader = z.infer<typeof SourceHeader>;
// What POST /api/sources returns. A repeat upload returns the first id with duplicate set (D8).
export const SourceCreateResponse = z.object({
  sourceId: z.string().uuid(),
  turnCount: z.number().int(),
  redactionCount: z.number().int(),
  duplicate: z.boolean(),
});
// The type of SourceCreateResponse, read from the schema above.
export type SourceCreateResponse = z.infer<typeof SourceCreateResponse>;
