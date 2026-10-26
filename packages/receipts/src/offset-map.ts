import { foldQuote } from "./norm-quote.js";

// Maps positions in normQuote(text) back to positions in text, in UTF-16 code units (D7), so the screen can highlight the original slice.
// toOriginal[i] is the index in original of the character that produced normalised[i]. Its last entry is the end of original.
// The original text is kept here because a slice needs it, and the spec type lists it as an addition.
export type OffsetMap = { original: string; normalised: string; toOriginal: Uint32Array };

// Builds the map from the same steps as normQuote, so the two always agree on the normalised text (D7).
export function buildOffsetMap(text: string): OffsetMap {
  const folded = foldQuote(text);
  const toOriginal = new Uint32Array(folded.normalised.length + 1);
  folded.sources.forEach((source, index) => {
    toOriginal[index] = source;
  });
  toOriginal[folded.normalised.length] = text.length;
  return { original: text, normalised: folded.normalised, toOriginal };
}

// The original slice behind a match in the normalised text. The end is the first original character after the match.
export function originalSlice(map: OffsetMap, normStart: number, normEnd: number): { start: number; end: number; text: string } {
  const start = map.toOriginal[normStart] ?? 0;
  const end = map.toOriginal[normEnd] ?? map.original.length;
  return { start, end, text: map.original.slice(start, end) };
}
