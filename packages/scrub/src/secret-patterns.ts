import type { Category, Segment } from "./placeholders.js";

// One regex rule: what it finds, which capture group it replaces (0 for the whole match), an
// optional extra check that gets the value and the whole match, and an optional list of literals. A
// text holding none of the literals is skipped, so the rule's regex never runs on it (performance
// only). resumeAt says where the next try starts after a match that isValid rejects; without it the
// next try starts after the rejected match. extend, when given, returns where the replaced value
// ends; the value then runs past the pattern's own bound, and the next try starts after it.
export type PatternRule = {
  category: Category;
  pattern: RegExp;
  group: number;
  isValid?: (value: string, whole: string) => boolean;
  needs?: readonly string[];
  resumeAt?: (whole: string) => number;
  extend?: (text: string, start: number, value: string) => number;
};

// A private key block in PEM form, up to its END line or the end of the text. The key type is at
// most 40 characters, so the header can never backtrack across a long run of capitals.
export const PEM_PRIVATE_KEY: PatternRule = {
  category: "secret",
  group: 0,
  pattern:
    /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)/g,
};
// A URL with a user name and a password, such as postgres://user:pass@host/db. The password may
// hold any character but a space, including "/", "#" and "?", up to its last "@" (at most 1,024
// characters, so a failed try costs a bounded scan). The rule runs only on text that holds "://",
// and the match ends before the punctuation that ends a sentence.
export const URL_WITH_CREDENTIALS: PatternRule = {
  category: "url_credentials",
  group: 0,
  pattern: /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s@:]{1,128}:\S{0,1024}@\S*[^\s.,;:!?)\]}'"]/gi,
  needs: ["://"],
};
// A JSON web token: three base64url parts of at least 8 characters, the first two starting with
// eyJ.
export const JWT: PatternRule = {
  category: "jwt",
  group: 0,
  pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
};
// The value of an upper-case setting whose name contains KEY, SECRET, TOKEN, PASSWORD or PASSWD, as
// in DB_PASSWORD=hunter2. The name is matched once, at most 64 characters, and isSecretName checks
// its words. The pattern reads at most 1,024 characters of a value; extendSecretValue then runs the
// value on to its closing quote, to the end of its line when it has none, or to the end of its bare
// run, so no tail stays visible. A rejected name resumes at its own end, so the characters after it
// are read again only by names inside the bound. The rule runs only on text that holds "=" or ":".
export const SECRET_ASSIGNMENT: PatternRule = {
  category: "secret",
  group: 1,
  pattern:
    /\b[A-Z][A-Z0-9_]{0,63}[ \t]*[=:][ \t]*("[^"\n]{4,1024}|'[^'\n]{4,1024}|[^\s"']{4,1024})/g,
  needs: ["=", ":"],
  isValid: (value, whole) => isSecretName(whole),
  resumeAt: (whole) => leadingNameLength(whole),
  extend: (text, start, value) => extendSecretValue(text, start, value),
};
// The secret rules in the order scrub applies them; they run before the identifier rules.
export const SECRET_RULES: readonly PatternRule[] = [
  PEM_PRIVATE_KEY,
  URL_WITH_CREDENTIALS,
  JWT,
  SECRET_ASSIGNMENT,
];

// The words that make a setting name a secret name.
const SECRET_NAME_WORD = /KEY|SECRET|TOKEN|PASSWORD|PASSWD/;
// The name at the start of a matched assignment, such as DB_PASSWORD in DB_PASSWORD=hunter2.
const LEADING_NAME = /^[A-Z][A-Z0-9_]*/;
// The characters that end a bare setting value: whitespace, or a quote, which is how the bare
// branch of the pattern stops too.
const BARE_VALUE_BREAK = /[\s"']/;

// The length of the setting name at the start of a matched assignment, or 1 when none is found.
function leadingNameLength(whole: string): number {
  return Math.max(1, LEADING_NAME.exec(whole)?.[0].length ?? 1);
}

// True when the setting name at the start of a matched assignment contains one of the secret words.
function isSecretName(whole: string): boolean {
  const name = LEADING_NAME.exec(whole)?.[0] ?? "";
  return SECRET_NAME_WORD.test(name);
}

// True when a free text holds one of the literals a rule needs, or the rule names no literal at
// all.
function mayMatch(text: string, rule: PatternRule): boolean {
  return rule.needs === undefined || rule.needs.some((literal) => text.includes(literal));
}

// A free piece of text, with no category, as the splitting below leaves it.
function freePiece(text: string): Segment {
  return { text, isProtected: false, category: null };
}

// The index after the closing quote, scanning forward from `from`. With no closing quote on the
// line, the quoted value runs to the end of its line: the index of the line break, or the end of
// the text. The scan stops at the first line break either way, so the scan that follows resumes
// there.
function quotedValueEnd(text: string, from: number, quote: string): number {
  for (let index = from; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === quote) return index + 1;
    if (character === "\n") return index;
  }
  return text.length;
}

// The index where a bare value's run ends: the next whitespace or quote, or the end of the text.
function bareRunEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length && !BARE_VALUE_BREAK.test(text.charAt(index))) index += 1;
  return index;
}

// The end of a secret value that the bounded pattern cut short. A quoted value runs to its closing
// quote, or to the end of its line when it has none. A bare value runs to the next whitespace or
// quote.
function extendSecretValue(text: string, start: number, value: string): number {
  const opener = text.charAt(start);
  if (opener === '"' || opener === "'") return quotedValueEnd(text, start + 1, opener);
  return bareRunEnd(text, start + value.length);
}

// The span of text one match replaces, as [start, end), or null when the rule refuses the match by
// its name check.
function replacedSpan(
  text: string,
  match: RegExpExecArray,
  rule: PatternRule,
): [number, number] | null {
  const value = match[rule.group];
  if (value === undefined || value === "") return null;
  if (rule.isValid !== undefined && !rule.isValid(value, match[0])) return null;
  const start = match.index + match[0].lastIndexOf(value);
  if (rule.extend === undefined) return [start, start + value.length];
  return [start, rule.extend(text, start, value)];
}

// After a refused match, the next try starts where the rule's resumeAt says, when the rule has one.
function resumeAfterRefusal(pattern: RegExp, match: RegExpExecArray, rule: PatternRule): void {
  if (rule.resumeAt !== undefined)
    pattern.lastIndex = match.index + Math.max(1, rule.resumeAt(match[0]));
}

// Splits one free segment at every match of the rule that passes its checks; each value the rule
// replaces becomes a protected piece.
function splitByRule(segment: Segment, rule: PatternRule): Segment[] {
  const text = segment.text;
  const pieces: Segment[] = [];
  const pattern = rule.pattern;
  pattern.lastIndex = 0;
  let last = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const span = replacedSpan(text, match, rule);
    if (span === null) {
      resumeAfterRefusal(pattern, match, rule);
      continue;
    }
    const [start, end] = span;
    if (start > last) pieces.push(freePiece(text.slice(last, start)));
    pieces.push({ text: text.slice(start, end), isProtected: true, category: rule.category });
    last = end;
    if (end > match.index + match[0].length) pattern.lastIndex = end;
  }
  if (last < text.length) pieces.push(freePiece(text.slice(last)));
  return pieces.length === 0 ? [segment] : pieces;
}

// Applies one rule to every free segment and protects each value it replaces, so no later rule sees
// it.
export function applyPatternRule(segments: Segment[], rule: PatternRule): Segment[] {
  return segments.flatMap((segment) => {
    if (segment.isProtected || !mayMatch(segment.text, rule)) return [segment];
    return splitByRule(segment, rule);
  });
}
