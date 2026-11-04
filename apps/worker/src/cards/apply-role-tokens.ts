import {
  PLACEHOLDER_PATTERN,
  ROLE_TOKEN,
  SENSITIVE_CATEGORIES,
  TURN_TEXT_MAX_CHARS,
} from "@meet-first/contracts";

// The role the scrub-names prompt gives a person under 18; such a name stays replaced, with no keep choice in the names review.
export const MINOR_ROLE = "child";
// Scripts written without spaces between words: a name in them is matched as a plain substring.
export const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
// The pattern text of a protected token: a redaction placeholder, a code placeholder, or a role token such as [person:colleague 2].
export const PROTECTED_TOKEN_SOURCE = String.raw`\[(?:redacted:[a-z_]+:[0-9a-f]{8}|code: [^\]\n]{0,80}|person:[^[\]\n]{1,60})\]`;
// Every protected token in a text. Use it only with matchAll, replace or split, because its g flag keeps state between test or exec calls.
export const PROTECTED_TOKEN = new RegExp(PROTECTED_TOKEN_SOURCE, "g");
// One name the names pass found, with its role and the role token it has in this source.
export type NameToken = { text: string; role: string; token: string; isMinor: boolean };
// The planned change to one turn: new text, sensitive categories, and how many times each token of the list was written into it.
export type TurnRewrite = {
  turnId: string;
  text: string;
  isTextChanged: boolean;
  categories: string[];
  isCategoriesChanged: boolean;
  occurrences: number[];
};
// One piece of a text while tokens are placed: plain text that may be matched, or a protected token that may not.
type Segment = { text: string; isProtected: boolean };

// A role from the model as the token's role: lower case, single spaces, no bracket or line break, at most 40 characters, "person" when nothing is left.
export function roleText(role: string): string {
  const cleaned = role
    .replace(/[[\]\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 40)
    .trim();
  return cleaned === "" ? "person" : cleaned;
}

// One token per distinct name, first seen first; a role already taken in this source becomes "<role> 2", then "<role> 3" and on (ingest spec 4.3.7).
export function assignTokens(names: ReadonlyArray<{ text: string; role: string }>): NameToken[] {
  const seen = new Set<string>();
  const used = new Set<string>();
  const tokens: NameToken[] = [];
  for (const name of names) {
    const text = name.text.trim();
    if (text === "" || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const base = roleText(name.role);
    let role = base;
    let suffix = 2;
    while (used.has(ROLE_TOKEN(role))) {
      role = `${base} ${String(suffix)}`;
      suffix += 1;
    }
    used.add(ROLE_TOKEN(role));
    tokens.push({ text, role, token: ROLE_TOKEN(role), isMinor: base === MINOR_ROLE });
  }
  return tokens;
}

// True when a name is the person's own: the display name, a word of it, or an affiliation, ignoring case.
export function isAllowlisted(
  name: string,
  person: { displayName: string; affiliations: readonly string[] },
): boolean {
  const key = name.trim().toLowerCase();
  const words = person.displayName.split(/\s+/).filter((word) => word.length >= 2);
  if (key === person.displayName.trim().toLowerCase()) return true;
  if (words.some((word) => word.toLowerCase() === key)) return true;
  return person.affiliations.some((affiliation) => affiliation.trim().toLowerCase() === key);
}

// The pattern that finds one name in plain text: whole words in spaced scripts, any position in scripts without spaces.
function namePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (NO_SPACE_SCRIPT.test(name)) return new RegExp(escaped, "giu");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, "giu");
}

// Orders tokens longest name first, so a full name is replaced before its first name.
function longestFirst(left: NameToken, right: NameToken): number {
  if (left.text.length !== right.text.length) return right.text.length - left.text.length;
  if (left.text < right.text) return -1;
  if (left.text > right.text) return 1;
  return 0;
}

// Replaces one token's name in every plain segment; protected segments pass through untouched.
function replaceInSegments(segments: readonly Segment[], token: NameToken): Segment[] {
  const pattern = namePattern(token.text);
  const next: Segment[] = [];
  for (const segment of segments) {
    if (segment.isProtected) {
      next.push(segment);
      continue;
    }
    let rest = 0;
    for (const match of segment.text.matchAll(pattern)) {
      const start = match.index;
      next.push({ text: segment.text.slice(rest, start), isProtected: false });
      next.push({ text: token.token, isProtected: true });
      rest = start + match[0].length;
    }
    next.push({ text: segment.text.slice(rest), isProtected: false });
  }
  return next;
}

// Rewrites every occurrence of every name in one turn's text into its role token; protected tokens are never touched.
export function applyRoleTokens(text: string, tokens: readonly NameToken[]): string {
  const split = text.split(new RegExp(`(${PROTECTED_TOKEN_SOURCE})`));
  let segments: Segment[] = split.map((part, index) => ({
    text: part,
    isProtected: index % 2 === 1,
  }));
  for (const token of [...tokens].sort(longestFirst)) segments = replaceInSegments(segments, token);
  return segments.map((segment) => segment.text).join("");
}

// Cuts a rewritten turn back to TURN_TEXT_MAX_CHARS without splitting a token.
export function fitTurnLength(text: string): string {
  if (text.length <= TURN_TEXT_MAX_CHARS) return text;
  const head = text.slice(0, TURN_TEXT_MAX_CHARS);
  const newline = head.lastIndexOf("\n");
  if (newline > 0) return head.slice(0, newline).trimEnd();
  let end = TURN_TEXT_MAX_CHARS;
  const straddling = [...text.matchAll(PROTECTED_TOKEN)].find((match) => {
    const start = match.index;
    return start < end && start + match[0].length > end;
  });
  if (straddling !== undefined) end = straddling.index;
  const lastUnit = text.charCodeAt(end - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

// How many times one token occurs in a text: one redaction row for each occurrence the pass wrote.
export function countToken(text: string, token: string): number {
  return text.split(token).length - 1;
}

// The sensitive categories of one turn after the names pass: existing tags, every SENSITIVE_CATEGORIES placeholder in the text, and minor when a child's name was replaced.
export function sensitiveCategoriesFor(
  text: string,
  existing: readonly string[],
  hasMinor: boolean,
): string[] {
  const categories = new Set<string>(existing);
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const category = match[1];
    if (category !== undefined && SENSITIVE_CATEGORIES.some((sensitive) => sensitive === category))
      categories.add(category);
  }
  if (hasMinor) categories.add("minor");
  return [...categories].sort();
}

// The rewrite of one turn for one set of tokens: new text, how often each token was written, and the categories it now carries.
function planOneTurn(
  turn: { id: string; text: string; sensitive_categories: readonly string[] },
  tokens: readonly NameToken[],
): TurnRewrite {
  const rewritten = fitTurnLength(applyRoleTokens(turn.text, tokens));
  const occurrences = tokens.map((token) =>
    Math.max(0, countToken(rewritten, token.token) - countToken(turn.text, token.token)),
  );
  const hasMinor = tokens.some((token, index) => token.isMinor && (occurrences[index] ?? 0) > 0);
  const categories = sensitiveCategoriesFor(rewritten, turn.sensitive_categories, hasMinor);
  const isTextChanged = rewritten !== turn.text;
  const isCategoriesChanged =
    categories.join(",") !== [...turn.sensitive_categories].sort().join(",");
  return {
    turnId: turn.id,
    text: rewritten,
    isTextChanged,
    categories,
    isCategoriesChanged,
    occurrences,
  };
}

// The rewrite of every turn of a source for one set of tokens, in turn order.
export function planTurnRewrites(
  turns: ReadonlyArray<{ id: string; text: string; sensitive_categories: readonly string[] }>,
  tokens: readonly NameToken[],
): TurnRewrite[] {
  return turns.map((turn) => planOneTurn(turn, tokens));
}
