import { CardBuildOutput, toStrictJsonSchema } from "@meet-first/contracts";
import { readPrompt } from "@meet-first/prompts";
import { NO_SPACE_SCRIPT, PROTECTED_TOKEN } from "./apply-role-tokens.js";
import { formatTurnBlock, TURN_BLOCK_SEPARATOR, type ModelCall } from "./name-chunks.js";
import type { FailedItem } from "./verify-items.js";

// Share of the card input filled first by the newest turns; the rest goes to keyword diversity.
export const RECENCY_SHARE = 0.5;
// Common English words that do not count as keywords for diversity.
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "you",
  "that",
  "with",
  "this",
  "have",
  "are",
  "was",
  "but",
  "not",
  "what",
  "all",
  "can",
  "her",
  "his",
  "one",
  "our",
  "out",
  "had",
  "has",
  "she",
  "they",
  "them",
  "their",
  "there",
  "from",
  "your",
  "about",
  "would",
  "which",
  "will",
  "like",
  "into",
  "than",
  "then",
  "when",
  "where",
  "who",
  "how",
  "also",
  "been",
  "did",
  "does",
  "some",
  "any",
  "more",
  "much",
  "other",
]);
// One turn as the card build uses it.
export type SampledTurn = {
  id: string;
  turnIndex: number;
  text: string;
  normText: string;
  isSensitive: boolean;
};
// One turn with its block cost and its keywords, computed once for the sampler.
type Candidate = { turn: SampledTurn; cost: number; keywords: Set<string> };

// The cost of one turn in the joined card input: its block and the separator after it.
function blockCost(turn: SampledTurn): number {
  return formatTurnBlock(turn).length + TURN_BLOCK_SEPARATOR.length;
}

// The newest turns, from the newest down, while they fit the recency allowance.
function takeRecent(
  candidates: readonly Candidate[],
  chosen: Set<number>,
  allowance: number,
): number {
  let used = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate !== undefined && used + candidate.cost <= allowance) {
      chosen.add(index);
      used += candidate.cost;
    }
  }
  return used;
}

// The room left in the card input: the budget and the cost already taken.
type Room = { budget: number; used: number };

// The turns that add new keywords, most new keywords first, each taken while it fits the budget.
function takeDiverse(candidates: readonly Candidate[], chosen: Set<number>, room: Room): number {
  const covered = new Set<string>();
  for (const index of chosen)
    for (const keyword of candidates[index]?.keywords ?? []) covered.add(keyword);
  const newCount = (candidate: Candidate): number =>
    [...candidate.keywords].filter((keyword) => !covered.has(keyword)).length;
  const order = candidates
    .map((candidate, index) => ({ index, candidate, fresh: newCount(candidate) }))
    .filter((entry) => !chosen.has(entry.index))
    .sort(
      (left, right) =>
        right.fresh - left.fresh || right.candidate.turn.turnIndex - left.candidate.turn.turnIndex,
    );
  let total = room.used;
  for (const entry of order) {
    const hasNewKeyword = [...entry.candidate.keywords].some((keyword) => !covered.has(keyword));
    if (total + entry.candidate.cost <= room.budget && hasNewKeyword) {
      chosen.add(entry.index);
      total += entry.candidate.cost;
      for (const keyword of entry.candidate.keywords) covered.add(keyword);
    }
  }
  return total;
}

// The newest turns that still fit, taken after the diversity step.
function takeFill(candidates: readonly Candidate[], chosen: Set<number>, room: Room): void {
  let total = room.used;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (chosen.has(index) || candidate === undefined) continue;
    if (total + candidate.cost <= room.budget) {
      chosen.add(index);
      total += candidate.cost;
    }
  }
}

// Picks whole turns for the card prompt: the newest up to half the cap, then the turns that add the
// most new keywords, then the newest of the rest, never over maxChars.
export function sampleTurns(turns: readonly SampledTurn[], maxChars: number): SampledTurn[] {
  const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
  const budget = maxChars + TURN_BLOCK_SEPARATOR.length;
  const total = ordered.reduce((sum, turn) => sum + blockCost(turn), 0);
  if (total <= budget) return ordered;
  const candidates: Candidate[] = ordered.map((turn) => ({
    turn,
    cost: blockCost(turn),
    keywords: keywordsOf(turn.text),
  }));
  const chosen = new Set<number>();
  const used = takeRecent(candidates, chosen, Math.floor(budget * RECENCY_SHARE));
  const afterDiversity = takeDiverse(candidates, chosen, { budget, used });
  takeFill(candidates, chosen, { budget, used: afterDiversity });
  return candidates.flatMap((candidate, index) => (chosen.has(index) ? [candidate.turn] : []));
}

// The keywords of a text: lower-case letter and digit runs of 3 or more characters minus
// STOP_WORDS; in scripts written without spaces, every 2-character window of a run.
export function keywordsOf(text: string): Set<string> {
  const plain = text.replace(PROTECTED_TOKEN, " ").toLowerCase();
  const words = plain.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const keywords = new Set<string>();
  for (const word of words) {
    const points = Array.from(word);
    if (NO_SPACE_SCRIPT.test(word)) {
      for (let index = 0; index + 1 < points.length; index += 1)
        keywords.add(`${points[index] ?? ""}${points[index + 1] ?? ""}`);
    } else if (points.length >= 3 && !STOP_WORDS.has(word)) {
      keywords.add(word);
    }
  }
  return keywords;
}

// The first card call: the dossier prompt and the untrusted-data rules as the system message, the
// sampled turns in turn_index order as the user message.
export function cardCall(turns: readonly SampledTurn[]): ModelCall {
  const prompt = readPrompt("dossier");
  const rules = readPrompt("untrusted-data-rules");
  const blocks = [...turns]
    .sort((a, b) => a.turnIndex - b.turnIndex)
    .map(formatTurnBlock)
    .join(TURN_BLOCK_SEPARATOR);
  return {
    callSite: "card",
    promptVersion: prompt.version,
    messages: [
      { role: "system", content: `${prompt.text}\n\n${rules.text}` },
      { role: "user", content: `<source_turns>\n${blocks}\n</source_turns>` },
    ],
    schema: toStrictJsonSchema(CardBuildOutput, "dossier"),
  };
}

// The one regeneration call: the first call's messages, the first reply as the assistant message,
// and the failed items as a new user message.
export function cardRegenerationCall(
  first: ModelCall,
  firstReplyText: string,
  failures: readonly FailedItem[],
): ModelCall {
  const lines = failures
    .map(
      (failure) =>
        `item ${String(failure.position)}: turn_id "${failure.item.turn_id}", reason ${failure.reason}`,
    )
    .join("\n");
  return {
    ...first,
    messages: [
      ...first.messages,
      { role: "assistant", content: firstReplyText },
      { role: "user", content: `<failed_items>\n${lines}\n</failed_items>` },
    ],
  };
}
