import { z } from "zod";

// The 17 redaction categories.
export const CATEGORIES = [
  "secret", "email", "phone", "url_credentials", "jwt", "nric", "aadhaar", "pan", "postal", "iban", "card",
  "address", "person", "health", "minor", "identifier", "code",
] as const;
// One redaction category, checked against the 17 names above.
export const Category = z.enum(CATEGORIES);
// The categories the person must opt into before they reach a card or recall.
// Email and phone are always redacted, so the "contacts" group of sensitive categories is not listed here.
export const SENSITIVE_CATEGORIES = ["health", "minor", "address", "identifier"] as const;
// One thing the scrubber replaced: its category and its eight hex placeholder id.
export const Redaction = z.object({ category: Category, placeholderId: z.string().regex(/^[0-9a-f]{8}$/) });
// The type of Redaction, read from the schema above.
export type Redaction = z.infer<typeof Redaction>;
// The scrubbed text of one turn with the redactions it made.
export const ScrubResult = z.object({ text: z.string(), redactions: z.array(Redaction) });
// The type of ScrubResult, read from the schema above.
export type ScrubResult = z.infer<typeof ScrubResult>;
// Finds every placeholder in text. Its parts are the category and the eight hex characters.
export const PLACEHOLDER_PATTERN = /\[redacted:([a-z_]+):([0-9a-f]{8})\]/g;
// The text that replaces a code block: its language and its line count.
export const CODE_FENCE_PLACEHOLDER = (lang: string, lines: number): string => `[code: ${lang || "text"}, ${String(lines)} lines]`;
// What the names pass returns from the model: names with the role each one plays.
// The 500 bound on names per chunk is a parse bound picked here.
export const NamesPassOutput = z.object({
  names: z.array(z.object({ text: z.string().min(1).max(120), role: z.string().min(1).max(40) })).max(500),
});
// The type of NamesPassOutput, read from the schema above.
export type NamesPassOutput = z.infer<typeof NamesPassOutput>;
// The stand-in for a person's name in the text, such as [person:mother].
export const ROLE_TOKEN = (role: string): string => `[person:${role}]`;
