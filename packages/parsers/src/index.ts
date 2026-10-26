// Turns file contents into the uploader's own turns (R1.1, D1).
export { extractOwnTurns, detectKind, type ExtractInput, type ExtractResult } from "./extract-own-turns.js";
// The one definition of canonical text, and the language label of a turn (D6, D7).
export { canonicalise, guessLang } from "./canonicalise.js";
// The share of prose turns that speak in the first person (R3.8).
export { computePersonaSignal } from "./persona-signal.js";
// The ranking and cutting to the caps of D5.
export { rankAndCut } from "./rank-and-cut.js";
// A message before canonicalisation, as the shape parsers return it.
export type { RawTurn } from "./chatgpt-shapes.js";
// The parser version stored on every source, so a later parser release can be told apart (R1.9).
export const PARSER_VERSION = "1";
