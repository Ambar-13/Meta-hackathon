import { CATEGORIES, ContractError, HTTP, PLACEHOLDER_PATTERN } from "@meet-first/contracts";

// One redaction category, one of the 17 names of CATEGORIES (contracts export the zod schema only, so the type is read here).
export type Category = (typeof CATEGORIES)[number];

// A piece of the text being scrubbed: free text that rules may still match, or a protected piece no rule touches.
// A protected piece with a category becomes one redaction; one with category null (a role token) is left as it is.
export type Segment = { text: string; isProtected: boolean; category: Category | null };

// A placeholder written by this scrubber or an earlier pass: [redacted:category:8 hex digits], the contracts pattern under a local name.
export const REDACTED_PLACEHOLDER = PLACEHOLDER_PATTERN;
// A code fence placeholder: [code: lang, n lines].
export const CODE_PLACEHOLDER = /\[code: ([a-z0-9_+#.-]{1,20}), (\d{1,9}) lines\]/g;
// A role token the names pass writes, such as [person:manager].
export const ROLE_TOKEN_PATTERN = /\[person:[^[\]\n]{1,60}\]/g;
// The largest id that 8 hex digits can hold.
export const PLACEHOLDER_ID_MAX = 0xffffffff;

// The sentence for an id counter that has run out, shown when a source has more redactions than 8 hex digits can name.
const IDS_EXHAUSTED_SENTENCE = "This source has more redactions than the ids allow. Upload a smaller export.";

// One placeholder found in a text: its kind, its category, whether that category is one of the 17, and where it sits.
export type FoundPlaceholder = { kind: "redacted" | "code"; category: string; isKnownCategory: boolean; start: number; end: number };

// True when a string is one of the 17 redaction categories.
export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

// Hands out ids 00000001, 00000002 and so on; start lets the names pass carry on after a source's highest id.
export function makePlaceholderCounter(start = 1): () => string {
  let next = start;
  return () => {
    if (next > PLACEHOLDER_ID_MAX) {
      throw new ContractError("placeholder_ids_exhausted", IDS_EXHAUSTED_SENTENCE, HTTP.payloadTooLarge);
    }
    const placeholderId = next.toString(16).padStart(8, "0");
    next += 1;
    return placeholderId;
  };
}

// Writes one placeholder, such as [redacted:email:00000001].
export function formatPlaceholder(category: Category, placeholderId: string): string {
  return `[redacted:${category}:${placeholderId}]`;
}

// Every placeholder in a text in order, with its kind, its category, whether the category is known, and where it sits.
export function findPlaceholders(text: string): FoundPlaceholder[] {
  const redacted = [...text.matchAll(REDACTED_PLACEHOLDER)].map((match): FoundPlaceholder => {
    const category = match[1] ?? "";
    const start = match.index;
    return { kind: "redacted", category, isKnownCategory: isCategory(category), start, end: start + match[0].length };
  });
  const code = [...text.matchAll(CODE_PLACEHOLDER)].map((match): FoundPlaceholder => {
    const start = match.index;
    return { kind: "code", category: "code", isKnownCategory: true, start, end: start + match[0].length };
  });
  return [...redacted, ...code].sort((a, b) => a.start - b.start);
}

// How many placeholders stand for a redaction: [redacted:...] with a known category, plus [code: ...].
export function countPlaceholders(text: string): number {
  return findPlaceholders(text).filter((found) => found.isKnownCategory).length;
}
