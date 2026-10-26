// Normalises one text so a quote and its turn compare like with like.
export { normQuote } from "./norm-quote.js";
// Maps normalised positions back to the original text, and slices the original.
export { buildOffsetMap, originalSlice, type OffsetMap } from "./offset-map.js";
// The quote check, with its two minimum lengths and its result types.
export {
  QUOTE_MIN_CHARS,
  QUOTE_MIN_CODE_POINTS_NO_SPACE,
  verifyQuote,
  type VerifyInput,
  type VerifyResult,
} from "./verify-quote.js";
