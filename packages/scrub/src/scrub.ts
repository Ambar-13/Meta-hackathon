import type { Redaction, ScrubResult } from "@meet-first/contracts";
import { CODE_PLACEHOLDER, REDACTED_PLACEHOLDER, ROLE_TOKEN_PATTERN, formatPlaceholder, isCategory, makePlaceholderCounter, type Segment } from "./placeholders.js";
import { replaceCodeFences } from "./code-fences.js";
import { SECRET_RULES, applyPatternRule } from "./secret-patterns.js";
import { IDENTIFIER_RULES } from "./identifier-patterns.js";
import { applyEntropyRule } from "./entropy.js";

// What a caller passes: the names to leave alone (D17) and, optionally, where placeholder ids come from.
export type ScrubOptions = { allowlist: readonly string[]; nextId?: () => string };

// Every placeholder kind already in a text: a redacted one, a code one, or a role token, as one pattern with groups in that order.
const EXISTING_TOKENS = new RegExp(REDACTED_PLACEHOLDER.source + "|" + CODE_PLACEHOLDER.source + "|" + ROLE_TOKEN_PATTERN.source, "g");

// How a placeholder found in free text is protected: its category, or null for a role token, or null overall when it stays free.
function protectedCategory(match: RegExpMatchArray): { category: Segment["category"] } | null {
  const name = match[1];
  if (name !== undefined) return isCategory(name) ? { category: name } : null;
  if (match[3] !== undefined) return { category: "code" };
  return { category: null };
}

// Protects the placeholders of one free segment, leaving the text between them free.
function markFree(segment: Segment): Segment[] {
  const pieces: Segment[] = [];
  let last = 0;
  for (const match of segment.text.matchAll(EXISTING_TOKENS)) {
    const found = protectedCategory(match);
    if (found === null) continue;
    const start = match.index;
    if (start > last) pieces.push({ text: segment.text.slice(last, start), isProtected: false, category: null });
    pieces.push({ text: match[0], isProtected: true, category: found.category });
    last = start + match[0].length;
  }
  if (pieces.length === 0) return [segment];
  if (last < segment.text.length) pieces.push({ text: segment.text.slice(last), isProtected: false, category: null });
  return pieces;
}

// Protects the placeholders and role tokens already in the text, so a second pass keeps them and gives each placeholder a new id in order.
export function markExistingPlaceholders(segments: Segment[]): Segment[] {
  return segments.flatMap((segment) => (segment.isProtected ? [segment] : markFree(segment)));
}

// Joins the segments into the final text, giving each redaction the next id in text order, and lists the redactions (D14).
export function assignPlaceholderIds(segments: Segment[], nextId: () => string): ScrubResult {
  let text = "";
  const redactions: Redaction[] = [];
  for (const segment of segments) {
    if (segment.category === null) {
      text += segment.text;
      continue;
    }
    const placeholderId = nextId();
    redactions.push({ category: segment.category, placeholderId });
    text += segment.category === "code" ? segment.text : formatPlaceholder(segment.category, placeholderId);
  }
  return { text, redactions };
}

// Replaces every secret, identifier and code fence in one text with a placeholder and lists the replacements in text order (D11 to D14).
// Pass one nextId for a whole source so ids stay unique across its turns.
export function scrub(text: string, options: ScrubOptions): ScrubResult {
  const nextId = options.nextId ?? makePlaceholderCounter();
  let segments = replaceCodeFences(text);
  segments = markExistingPlaceholders(segments);
  for (const rule of [...SECRET_RULES, ...IDENTIFIER_RULES]) segments = applyPatternRule(segments, rule);
  segments = applyEntropyRule(segments, options.allowlist);
  return assignPlaceholderIds(segments, nextId);
}
