import { CANONICAL_TEXT_MAX_BYTES, TURN_TEXT_MAX_CHARS, type Turn } from "@meet-first/contracts";
import {
  countPlaceholders,
  findPlaceholders,
  makePlaceholderCounter,
  scrub,
} from "@meet-first/scrub";

// The turns after the browser's scrub, and the count shown with the consent copy.
export type ScrubPreview = { turns: Turn[]; previewRedactionCount: number };

// True when a UTF-16 code unit is the first half of a surrogate pair, so cutting after it would
// split an emoji.
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

// Cuts a scrubbed turn to 20,000 characters at the last line break, or else at a point that splits
// no placeholder and no surrogate pair.
export function cutScrubbedText(text: string): string {
  const lineBreak = text.lastIndexOf("\n", TURN_TEXT_MAX_CHARS);
  if (lineBreak > 0) return text.slice(0, lineBreak);
  let end = TURN_TEXT_MAX_CHARS;
  for (const placeholder of findPlaceholders(text)) {
    if (placeholder.start < end && end < placeholder.end) end = placeholder.start;
  }
  if (isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

// Drops turns from the end until the texts together fit the 2 MiB cap.
function dropOverCap(turns: Turn[]): Turn[] {
  const kept = [...turns];
  let total = kept.reduce((sum, turn) => sum + turn.text.length, 0);
  while (total > CANONICAL_TEXT_MAX_BYTES && kept.length > 0) {
    const last = kept.pop();
    if (last === undefined) break;
    total -= last.text.length;
  }
  return kept;
}

// Scrubs the kept turns with one placeholder counter for the source and re-applies the 20,000 and 2
// MiB caps.
export function scrubForUpload(turns: readonly Turn[], allowlist: readonly string[]): ScrubPreview {
  const nextId = makePlaceholderCounter();
  const scrubbed = turns.map((turn): Turn => {
    const text = scrub(turn.text, { allowlist, nextId }).text;
    return { ...turn, text: text.length > TURN_TEXT_MAX_CHARS ? cutScrubbedText(text) : text };
  });
  const kept = dropOverCap(scrubbed);
  const previewRedactionCount = kept.reduce((sum, turn) => sum + countPlaceholders(turn.text), 0);
  return { turns: kept, previewRedactionCount };
}
