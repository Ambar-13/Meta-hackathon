import { CARD_ITEMS_MAX, CardBuildOutput } from "@meet-first/contracts";
import {
  normQuote,
  QUOTE_MIN_CHARS,
  QUOTE_MIN_CODE_POINTS_NO_SPACE,
  verifyQuote,
} from "@meet-first/receipts";
import { PROTECTED_TOKEN } from "./apply-role-tokens.js";
import type { SampledTurn } from "./turn-sampler.js";

// One item of the model's card reply (contracts CardBuildOutput).
export type CardOutputItem = CardBuildOutput["items"][number];
// An item whose quote was found inside its named turn.
export type VerifiedItem = {
  ok: true;
  position: number;
  item: CardOutputItem;
  turn: SampledTurn;
  normQuote: string;
};
// An item that failed, with its 1-based position in the reply and the reason the regeneration message names.
export type FailedItem = {
  ok: false;
  position: number;
  item: CardOutputItem;
  reason: "unknown_turn" | "too_short" | "not_in_turn" | "substring_of_prompt";
};
// The result of checking one item.
export type ItemCheck = VerifiedItem | FailedItem;
// The accepted forms of a turn label in a reply: "12", "t:12" or "[t:12]".
export const TURN_LABEL = /^\s*\[?(?:t:)?(\d{1,6})\]?\s*$/;

// The turn_index a reply label points at, or null when it is not a label of the sample.
export function labelToTurnIndex(
  label: string,
  turns: ReadonlyMap<number, SampledTurn>,
): number | null {
  const match = TURN_LABEL.exec(label);
  if (match === null) return null;
  const index = Number(match[1]);
  return turns.has(index) ? index : null;
}

// True when the quote's own words, outside placeholders and role tokens, still meet the minimum.
export function hasEnoughOwnText(quote: string): boolean {
  const own = normQuote(quote.replace(PROTECTED_TOKEN, " "));
  if (own.includes(" ")) return own.length >= QUOTE_MIN_CHARS;
  return Array.from(own).length >= QUOTE_MIN_CODE_POINTS_NO_SPACE;
}

// The sampled turn an item's label names, or undefined when the label is not in the sample.
function turnNamedBy(
  label: string,
  turns: ReadonlyMap<number, SampledTurn>,
): SampledTurn | undefined {
  const index = labelToTurnIndex(label, turns);
  return index === null ? undefined : turns.get(index);
}

// Checks one item against the one turn its label names, in the order of the rules.
function checkItem(
  entry: { item: CardOutputItem; position: number },
  turns: ReadonlyMap<number, SampledTurn>,
  forbidden: readonly string[],
): ItemCheck {
  const { item, position } = entry;
  const turn = turnNamedBy(item.turn_id, turns);
  if (turn === undefined) return { ok: false, position, item, reason: "unknown_turn" };
  if (!hasEnoughOwnText(item.quote)) return { ok: false, position, item, reason: "too_short" };
  const result = verifyQuote({
    quote: item.quote,
    turnText: turn.text,
    turnNormText: turn.normText,
    forbidden,
  });
  if (result.ok) return { ok: true, position, item, turn, normQuote: normQuote(item.quote) };
  return { ok: false, position, item, reason: result.reason };
}

// Checks every item against the one turn its label names, never any other turn.
export function verifyItems(
  items: readonly CardOutputItem[],
  turns: ReadonlyMap<number, SampledTurn>,
  forbidden: readonly string[],
): ItemCheck[] {
  return items.map((item, index) => checkItem({ item, position: index + 1 }, turns, forbidden));
}

// The identity of a verified quote: its turn and its normalised text, so one quote counts once.
function quoteKey(check: VerifiedItem): string {
  return `${String(check.turn.turnIndex)}|${check.normQuote}`;
}

// The first call's verified items in order, then the second call's verified items not already present, at most 40.
export function mergeVerified(
  first: readonly ItemCheck[],
  second: readonly ItemCheck[],
): VerifiedItem[] {
  const merged = first.filter((check): check is VerifiedItem => check.ok);
  const keys = new Set(merged.map(quoteKey));
  for (const check of second) {
    if (!check.ok || keys.has(quoteKey(check))) continue;
    keys.add(quoteKey(check));
    merged.push(check);
  }
  return merged.slice(0, CARD_ITEMS_MAX);
}
