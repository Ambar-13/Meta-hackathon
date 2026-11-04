// Turns file contents into the uploader's own turns.
export {
  extractOwnTurns,
  detectKind,
  type ExtractInput,
  type ExtractResult,
} from "./extract-own-turns.js";
// The one definition of canonical text, and the language label of a turn.
export { canonicalise, guessLang } from "./canonicalise.js";
// The share of prose turns that speak in the first person.
export { computePersonaSignal } from "./persona-signal.js";
// The ranking and cutting to the size caps.
export { rankAndCut } from "./rank-and-cut.js";
// A pasted summary read into points, and the quotes and topics the browser keeps first.
export {
  formatSummary,
  parseSummary,
  summaryPriority,
  type SummaryPriority,
} from "./summary-format.js";
// The file name of a Codex session log, and the lines of it the Codex reader needs, so the upload can stream a large log line by line.
export { CODEX_FILE_NAME, isCodexLineWanted } from "./codex-shapes.js";
// A message before canonicalisation, as the shape parsers return it.
export type { RawTurn } from "./chatgpt-shapes.js";
// The parser version stored on every source, so a later parser release can be told apart.
export const PARSER_VERSION = "1";
