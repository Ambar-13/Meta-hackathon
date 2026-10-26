import type { Category, Segment } from "./placeholders.js";

// One regex rule: what it finds, which capture group it replaces (0 for the whole match), an optional extra check that gets the
// value and the whole match, and an optional list of literals. A text holding none of the literals is skipped, so the rule's regex
// never runs on it (performance only). retryAfterSkip makes a skipped match give way to a match that starts one character later.
export type PatternRule = {
  category: Category;
  pattern: RegExp;
  group: number;
  isValid?: (value: string, whole: string) => boolean;
  needs?: readonly string[];
  retryAfterSkip?: boolean;
};

// A private key block in PEM form, up to its END line or the end of the text (R2.2). The key type is at most 40 characters, so the
// header can never backtrack across a long run of capitals.
export const PEM_PRIVATE_KEY: PatternRule = {
  category: "secret",
  group: 0,
  pattern: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)/g,
};
// A URL with a user name and a password, such as postgres://user:pass@host/db (R2.2). The password may hold any character but a
// space, including "/", "#" and "?", up to its last "@" (at most 1,024 characters, so a failed try costs a bounded scan). The
// rule runs only on text that holds "://", and the match ends before the punctuation that ends a sentence.
export const URL_WITH_CREDENTIALS: PatternRule = {
  category: "url_credentials",
  group: 0,
  pattern: /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s@:]{1,128}:\S{0,1024}@\S*[^\s.,;:!?)\]}'"]/gi,
  needs: ["://"],
};
// A JSON web token: three base64url parts of at least 8 characters, the first two starting with eyJ (R2.2).
export const JWT: PatternRule = {
  category: "jwt",
  group: 0,
  pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
};
// The value of an upper-case setting whose name contains KEY, SECRET, TOKEN, PASSWORD or PASSWD, as in DB_PASSWORD=hunter2 (R2.1, R2.2).
// The name is matched once, at most 64 characters, and isSecretName checks its words. The rule runs only on text that holds "=" or ":".
export const SECRET_ASSIGNMENT: PatternRule = {
  category: "secret",
  group: 1,
  pattern: /\b[A-Z][A-Z0-9_]{0,63}[ \t]*[=:][ \t]*("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"']{4,})/g,
  needs: ["=", ":"],
  isValid: (value, whole) => isSecretName(whole),
  retryAfterSkip: true,
};
// The secret rules in the order scrub applies them; they run before the identifier rules (R2.2).
export const SECRET_RULES: readonly PatternRule[] = [PEM_PRIVATE_KEY, URL_WITH_CREDENTIALS, JWT, SECRET_ASSIGNMENT];

// The words that make a setting name a secret name (R2.1, R2.2).
const SECRET_NAME_WORD = /KEY|SECRET|TOKEN|PASSWORD|PASSWD/;
// The name at the start of a matched assignment, such as DB_PASSWORD in DB_PASSWORD=hunter2.
const LEADING_NAME = /^[A-Z][A-Z0-9_]*/;

// True when the setting name at the start of a matched assignment contains one of the secret words.
function isSecretName(whole: string): boolean {
  const name = LEADING_NAME.exec(whole)?.[0] ?? "";
  return SECRET_NAME_WORD.test(name);
}

// True when a free text holds one of the literals a rule needs, or the rule names no literal at all.
function mayMatch(text: string, rule: PatternRule): boolean {
  return rule.needs === undefined || rule.needs.some((literal) => text.includes(literal));
}

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
    if (rule.isValid !== undefined && !rule.isValid(value, match[0])) {
      if (rule.retryAfterSkip === true) pattern.lastIndex = match.index + 1;
      continue;
    }
    const start = match.index + match[0].lastIndexOf(value);
    if (start > last) pieces.push(freePiece(segment.text.slice(last, start)));
    pieces.push({ text: value, isProtected: true, category: rule.category });
    last = start + value.length;
  }
  if (last < segment.text.length) pieces.push(freePiece(segment.text.slice(last)));
  return pieces.length === 0 ? [segment] : pieces;
}

// Applies one rule to every free segment and protects each value it replaces, so no later rule sees it.
export function applyPatternRule(segments: Segment[], rule: PatternRule): Segment[] {
  return segments.flatMap((segment) => {
    if (segment.isProtected || !mayMatch(segment.text, rule)) return [segment];
    return splitByRule(segment, rule);
  });
}
