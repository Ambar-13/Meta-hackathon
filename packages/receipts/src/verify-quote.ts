import { normQuote } from "./norm-quote.js";
import { buildOffsetMap, originalSlice } from "./offset-map.js";

// Shortest quote, in normalised characters, when it has spaces.
export const QUOTE_MIN_CHARS = 20;
// Shortest quote, in code points, when it has no spaces, as in Chinese or Japanese.
export const QUOTE_MIN_CODE_POINTS_NO_SPACE = 10;
// What one check gets: the model's quote, the turn it names, that turn's stored normal text, and the text the quote must not copy.
export type VerifyInput = {
  quote: string;
  turnText: string;
  turnNormText: string;
  forbidden: readonly string[];
};
// The result: where the quote sits in the turn, or the first rule it broke.
export type VerifyResult =
  | { ok: true; normStart: number; normEnd: number; originalStart: number; originalEnd: number }
  | { ok: false; reason: "too_short" | "not_in_turn" | "substring_of_prompt" };

// Whether the quote is too short to prove anything. Spaced text counts characters, unspaced text counts code points.
function isTooShort(quote: string): boolean {
  if (quote.includes(" ")) return quote.length < QUOTE_MIN_CHARS;
  return [...quote].length < QUOTE_MIN_CODE_POINTS_NO_SPACE;
}

// Checks one quote against one turn only. The turn is the one the model named; nothing else is searched.
// Rules run in order: too short, copied from the prompt, found in the turn.
export function verifyQuote(input: VerifyInput): VerifyResult {
  const quote = normQuote(input.quote);
  if (isTooShort(quote)) return { ok: false, reason: "too_short" };
  if (input.forbidden.some((text) => normQuote(text).includes(quote)))
    return { ok: false, reason: "substring_of_prompt" };
  const index = input.turnNormText.indexOf(quote);
  if (index === -1) return { ok: false, reason: "not_in_turn" };
  const slice = originalSlice(buildOffsetMap(input.turnText), index, index + quote.length);
  return {
    ok: true,
    normStart: index,
    normEnd: index + quote.length,
    originalStart: slice.start,
    originalEnd: slice.end,
  };
}
