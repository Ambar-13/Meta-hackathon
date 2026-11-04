import {
  CANONICAL_TEXT_MAX_BYTES,
  TURNS_PER_SOURCE_MAX,
  TURN_TEXT_MAX_CHARS,
} from "@meet-first/contracts";
import type { RawTurn } from "./chatgpt-shapes.js";
import { personaScore } from "./persona-signal.js";
import type { SummaryPriority } from "./summary-format.js";

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
  if (a.createTime !== null && b.createTime !== null && a.createTime !== b.createTime)
    return b.createTime - a.createTime;
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

// Shortest summary quote that counts, once folded; a shorter one would match too many messages.
const PRIORITY_QUOTE_MIN_CHARS = 20;

// The matchers a summary gives: its folded quotes that are long enough, and a whole-word pattern per topic.
type PriorityMatchers = { quotes: string[]; topics: RegExp[] };

// Text folded for finding a summary quote in it: lower case, no quote marks, runs of space as one.
function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A pattern that finds a topic as a whole word, in any case: "Rentably" matches "rentably's plan", not "rentablyish".
function topicPattern(topic: string): RegExp {
  const escaped = topic.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
}

// The matchers of a summary priority, or none when there is no summary.
function matchersOf(priority: SummaryPriority | undefined): PriorityMatchers {
  if (priority === undefined) return { quotes: [], topics: [] };
  return {
    quotes: priority.quotes
      .map(foldForMatch)
      .filter((quote) => quote.length >= PRIORITY_QUOTE_MIN_CHARS),
    topics: priority.topics.filter((topic) => topic.trim() !== "").map(topicPattern),
  };
}

// How a summary ranks one turn: 2 when it holds one of the summary's quotes, 1 when it names one of its topics, else 0.
function priorityTier(canonical: string, matchers: PriorityMatchers): number {
  if (matchers.quotes.length > 0) {
    const folded = foldForMatch(canonical);
    if (matchers.quotes.some((quote) => folded.includes(quote))) return 2;
  }
  return matchers.topics.some((pattern) => pattern.test(canonical)) ? 1 : 0;
}

// Ranks turns and cuts to the size caps: at most 10,000 turns, 20,000 characters each, 2 MiB in all. With a summary, turns that hold
// one of its quotes come first, then turns that name one of its topics; then personaScore, then recency. A turn longer than
// 20,000 characters is cut at the last line break before 20,000, so a quote never starts mid-line.
export function rankAndCut(
  turns: Array<RawTurn & { canonical: string }>,
  priority?: SummaryPriority,
): Array<RawTurn & { canonical: string }> {
  const matchers = matchersOf(priority);
  const scored = turns.map((turn) => {
    const cut: Ranked = { ...turn, canonical: cutTurnText(turn.canonical) };
    return {
      turn: cut,
      tier: priorityTier(cut.canonical, matchers),
      score: personaScore(cut.canonical),
    };
  });
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier;
    if (a.score !== b.score) return b.score - a.score;
    return byRecency(a.turn, b.turn);
  });
  const kept = takeWithinCaps(scored.map((entry) => entry.turn));
  return kept.sort((a, b) => a.exportOrder - b.exportOrder);
}
