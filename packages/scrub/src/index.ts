// The one scrub function the browser preview and the API both call (D11).
export { scrub, type ScrubOptions } from "./scrub.js";
// Placeholder ids, and writing, finding and counting placeholders (D14, R2.5).
export { makePlaceholderCounter, formatPlaceholder, findPlaceholders, countPlaceholders, isCategory, PLACEHOLDER_ID_MAX } from "./placeholders.js";
// The scrub version stored on every source, so a later rule set can be told apart (R2.9).
export const SCRUB_VERSION = "1";
