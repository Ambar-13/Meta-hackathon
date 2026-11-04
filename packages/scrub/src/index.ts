// The one scrub function the browser preview and the API both call.
export { scrub, type ScrubOptions } from "./scrub.js";
// Placeholder ids, and writing, finding and counting placeholders.
export {
  makePlaceholderCounter,
  formatPlaceholder,
  findPlaceholders,
  countPlaceholders,
  isCategory,
  PLACEHOLDER_ID_MAX,
} from "./placeholders.js";
// The scrub version stored on every source, so a later rule set can be told apart.
export const SCRUB_VERSION = "1";
