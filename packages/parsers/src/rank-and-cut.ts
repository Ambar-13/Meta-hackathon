import { CANONICAL_TEXT_MAX_BYTES, TURNS_PER_SOURCE_MAX, TURN_TEXT_MAX_CHARS } from "@meet-first/contracts";
import type { RawTurn } from "./chatgpt-shapes.js";
import { personaScore } from "./persona-signal.js";

// One turn as ranking sees it: the raw fields plus the canonical text it is cut from.
type Ranked = RawTurn & { canonical: string };

// Long turns are cut at a line break rather than mid-line.
export const isCutAtLineBreak = true; // a single long turn is cut at a line break where it can be

// True when a UTF-16 code unit is the first half of a surrogate pair, so cutting after it would split an emoji.
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

// Cuts one canonical text to 20,000 code units at the last line break, or else mid-text without splitting an emoji.
function cutTurnText(text: string): string {
  if (text.length <= TURN_TEXT_MAX_CHARS) return text;
  const lineBreak = text.lastIndexOf("\n", TURN_TEXT_MAX_CHARS);
  if (lineBreak > 0) return text.slice(0, lineBreak);
  const isSplitEmoji = isHighSurrogate(text.charCodeAt(TURN_TEXT_MAX_CHARS - 1));
  return text.slice(0, isSplitEmoji ? TURN_TEXT_MAX_CHARS - 1 : TURN_TEXT_MAX_CHARS);
}

// Recency order: newer createTime first, turns without a time after every timed turn, then the later export position first.
function byRecency(a: Ranked, b: Ranked): number {
  if (a.createTime !== null && b.createTime !== null && a.createTime !== b.createTime) return b.createTime - a.createTime;
  if (a.createTime === null && b.createTime !== null) return 1;
  if (a.createTime !== null && b.createTime === null) return -1;
  return b.exportOrder - a.exportOrder;
}

// Keeps turns in rank order while the count and the character total stay within the caps, and stops at the first turn that breaks one.
function takeWithinCaps(ranked: Ranked[]): Ranked[] {
  const kept: Ranked[] = [];
  let totalChars = 0;
  for (const turn of ranked) {
    if (kept.length >= TURNS_PER_SOURCE_MAX) break;
    if (totalChars + turn.canonical.length > CANONICAL_TEXT_MAX_BYTES) break;
    kept.push(turn);
    totalChars += turn.canonical.length;
  }
  return kept;
}

// Ranks turns by personaScore then recency and cuts to the size caps: at most 10,000 turns, 20,000 characters each, 2 MiB in all.
// A turn longer than 20,000 characters is cut at the last line break before 20,000, so a quote never starts mid-line.
export function rankAndCut(turns: Array<RawTurn & { canonical: string }>): Array<RawTurn & { canonical: string }> {
  const scored = turns.map((turn) => {
    const cut: Ranked = { ...turn, canonical: cutTurnText(turn.canonical) };
    return { turn: cut, score: personaScore(cut.canonical) };
  });
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return byRecency(a.turn, b.turn);
  });
  const kept = takeWithinCaps(scored.map((entry) => entry.turn));
  return kept.sort((a, b) => a.exportOrder - b.exportOrder);
}
