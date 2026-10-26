import type { Segment } from "./placeholders.js";

// Tokens shorter than this are never treated as keys (D12).
export const ENTROPY_MIN_LENGTH = 20;
// The Shannon entropy, in bits per character, that a token must exceed (D12).
export const ENTROPY_MIN_BITS_PER_CHAR = 3.5;
// Allowlist entries shorter than this protect nothing, so a two-letter name cannot shield a key that happens to contain it (D17) [confirm].
export const ALLOWLIST_MIN_LENGTH = 3;

// Every character of a token is printable ASCII, so a long Tamil or Hindi word is never a key [confirm].
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
// Opening punctuation kept outside a token, such as a bracket or a quote.
const OPENING_PUNCTUATION = "([{<\"'`";
// Closing punctuation kept outside a token, such as a bracket, a quote or a full stop.
const CLOSING_PUNCTUATION = ")]}>\"'`.,;:!?";

// Shannon entropy of a string in bits per character: minus the sum, over its distinct characters, of p times log2 p.
export function shannonEntropy(token: string): number {
  const chars = [...token];
  if (chars.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const character of chars) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const probability = count / chars.length;
    bits -= probability * Math.log2(probability);
  }
  return bits;
}

// True when a token looks like a key: long enough, printable ASCII, random enough, and holding no allowlisted name (D12, D17).
function isKeyLike(token: string, names: readonly string[]): boolean {
  if (token.length < ENTROPY_MIN_LENGTH || !PRINTABLE_ASCII.test(token)) return false;
  if (shannonEntropy(token) <= ENTROPY_MIN_BITS_PER_CHAR) return false;
  const lower = token.toLowerCase();
  return !names.some((name) => lower.includes(name));
}

// The token inside one whitespace-separated run, with the opening punctuation before it counted as its lead. Both ends are
// trimmed by a plain loop: a regex that looks for the end from every position backtracks quadratically on a long run of punctuation.
function coreOf(raw: string): { token: string; lead: number } {
  let lead = 0;
  while (lead < raw.length && OPENING_PUNCTUATION.includes(raw.charAt(lead))) lead += 1;
  let end = raw.length;
  while (end > lead && CLOSING_PUNCTUATION.includes(raw.charAt(end - 1))) end -= 1;
  return { token: raw.slice(lead, end), lead };
}

// Splits one free segment at every whitespace-separated token that looks like a key; each such token becomes a secret piece.
function splitTokens(segment: Segment, names: readonly string[]): Segment[] {
  const pieces: Segment[] = [];
  let last = 0;
  for (const match of segment.text.matchAll(/\S+/g)) {
    const { token, lead } = coreOf(match[0]);
    if (!isKeyLike(token, names)) continue;
    const start = match.index + lead;
    if (start > last) pieces.push({ text: segment.text.slice(last, start), isProtected: false, category: null });
    pieces.push({ text: token, isProtected: true, category: "secret" });
    last = start + token.length;
  }
  if (pieces.length === 0) return [segment];
  if (last < segment.text.length) pieces.push({ text: segment.text.slice(last), isProtected: false, category: null });
  return pieces;
}

// Replaces each token of 20 or more printable ASCII characters with entropy over 3.5 bits per character, unless it contains an allowlisted name (D12, D17).
export function applyEntropyRule(segments: Segment[], allowlist: readonly string[]): Segment[] {
  const names = allowlist
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length >= ALLOWLIST_MIN_LENGTH);
  return segments.flatMap((segment) => (segment.isProtected ? [segment] : splitTokens(segment, names)));
}
