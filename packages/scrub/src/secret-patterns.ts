import type { Category, Segment } from "./placeholders.js";

// One regex rule: what it finds, which capture group it replaces (0 for the whole match), an optional extra check, and an optional
// literal every match must contain. A text without that literal is skipped, which spares a slow scan of long words (performance only).
export type PatternRule = { category: Category; pattern: RegExp; group: number; isValid?: (value: string) => boolean; needs?: string };

// A private key block in PEM form, up to its END line or the end of the text (R2.2).
export const PEM_PRIVATE_KEY: PatternRule = {
  category: "secret",
  group: 0,
  pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
};
// A URL with a user name and a password, such as postgres://user:pass@host/db, without the punctuation that ends a sentence (R2.2).
export const URL_WITH_CREDENTIALS: PatternRule = {
  category: "url_credentials",
  group: 0,
  pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/?#]+:[^\s@/?#]*@\S*[^\s.,;:!?)\]}'"]/gi,
};
// A JSON web token: three base64url parts of at least 8 characters, the first two starting with eyJ (R2.2).
export const JWT: PatternRule = {
  category: "jwt",
  group: 0,
  pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
};
// The value of an upper-case setting whose name contains KEY, SECRET, TOKEN, PASSWORD or PASSWD, as in DB_PASSWORD=hunter2 (R2.1, R2.2).
export const SECRET_ASSIGNMENT: PatternRule = {
  category: "secret",
  group: 1,
  pattern: /\b[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*[ \t]*[=:][ \t]*("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"']{4,})/g,
};
// The secret rules in the order scrub applies them; they run before the identifier rules (R2.2).
export const SECRET_RULES: readonly PatternRule[] = [PEM_PRIVATE_KEY, URL_WITH_CREDENTIALS, JWT, SECRET_ASSIGNMENT];

// A free piece of text, with no category, as the splitting below leaves it.
function freePiece(text: string): Segment {
  return { text, isProtected: false, category: null };
}

// Splits one free segment at every match of the rule that passes its check; each value the rule replaces becomes a protected piece.
function splitByRule(segment: Segment, rule: PatternRule): Segment[] {
  const pieces: Segment[] = [];
  const pattern = rule.pattern;
  pattern.lastIndex = 0;
  let last = 0;
  for (let match = pattern.exec(segment.text); match !== null; match = pattern.exec(segment.text)) {
    const value = match[rule.group];
    if (value === undefined || value === "") continue;
    if (rule.isValid !== undefined && !rule.isValid(value)) continue;
    const start = match.index + match[0].lastIndexOf(value);
    if (start > last) pieces.push(freePiece(segment.text.slice(last, start)));
    pieces.push({ text: value, isProtected: true, category: rule.category });
    last = start + value.length;
  }
  if (last < segment.text.length) pieces.push(freePiece(segment.text.slice(last)));
  return pieces.length === 0 ? [segment] : pieces;
}

// True when a free text holds the literal a rule needs, or the rule names no literal at all.
function mayMatch(text: string, rule: PatternRule): boolean {
  return rule.needs === undefined || text.includes(rule.needs);
}

// Applies one rule to every free segment and protects each value it replaces, so no later rule sees it.
export function applyPatternRule(segments: Segment[], rule: PatternRule): Segment[] {
  return segments.flatMap((segment) => {
    if (segment.isProtected || !mayMatch(segment.text, rule)) return [segment];
    return splitByRule(segment, rule);
  });
}
