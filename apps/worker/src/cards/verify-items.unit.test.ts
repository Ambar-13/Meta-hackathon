import { describe, expect, it } from "vitest";
import { normQuote } from "@meet-first/receipts";
import { hasEnoughOwnText, labelToTurnIndex, mergeVerified, verifyItems, type CardOutputItem, type ItemCheck } from "./verify-items.js";
import { type SampledTurn } from "./turn-sampler.js";

// One sampled turn with a uuid made from its index.
function turn(index: number, text: string): SampledTurn {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    turnIndex: index,
    text,
    normText: normQuote(text),
    isSensitive: false,
  };
}

// One card item as the model would return it, with a habit kind and a claim that says nothing.
function item(turnId: string, quote: string): CardOutputItem {
  return { kind: "habit", claim: "c", lang: "en", gloss: "c", turn_id: turnId, quote };
}

const turns = new Map<number, SampledTurn>([
  [4, turn(4, "I always ask for feedback in writing because I forget half of what people tell me in meetings.")],
  [6, turn(6, "I learn new tools by rebuilding something I already understand.")],
  [9, turn(9, "Mail [redacted:email:3f9a1c2e] today.")],
]);
const forbidden = ["unrelated system text"];

describe("verifyItems", () => {
  it("R3.2-T1: a quote inside its named turn is verified", () => {
    const [check] = verifyItems([item("4", "I always ask for feedback in writing")], turns, forbidden);
    expect(check).toMatchObject({ ok: true, position: 1, normQuote: "i always ask for feedback in writing" });
    expect(check?.ok && check.turn.turnIndex).toBe(4);
  });

  it("D26-T1: a quote that is only in another turn fails as not_in_turn", () => {
    const [check] = verifyItems([item("6", "I always ask for feedback in writing")], turns, forbidden);
    expect(check).toMatchObject({ ok: false, reason: "not_in_turn" });
  });

  it("R3.2-T2: an unknown label fails as unknown_turn", () => {
    const [unknownNumber] = verifyItems([item("99", "I always ask for feedback in writing")], turns, forbidden);
    const [unknownWord] = verifyItems([item("abc", "I always ask for feedback in writing")], turns, forbidden);
    expect(unknownNumber).toMatchObject({ ok: false, reason: "unknown_turn" });
    expect(unknownWord).toMatchObject({ ok: false, reason: "unknown_turn" });
  });

  it("D21-T4: the labels 4, t:4 and [t:4] all name turn 4", () => {
    for (const label of ["4", "t:4", "[t:4]", " 4 ", "[t:4"]) expect(labelToTurnIndex(label, turns)).toBe(4);
    for (const label of ["4a", "7"]) expect(labelToTurnIndex(label, turns)).toBeNull();
  });

  it("D25-T1: a quote of placeholders and too few own words fails as too_short", () => {
    const [placeholderOnly] = verifyItems([item("9", "[redacted:email:3f9a1c2e]")], turns, forbidden);
    const [fewWords] = verifyItems([item("9", "Mail [redacted:email:3f9a1c2e] today")], turns, forbidden);
    expect(placeholderOnly).toMatchObject({ ok: false, reason: "too_short" });
    expect(fewWords).toMatchObject({ ok: false, reason: "too_short" });
    expect(hasEnoughOwnText("[redacted:email:3f9a1c2e]")).toBe(false);
  });

  it("R6.6-T1: a quote taken from the prompt fails as substring_of_prompt", () => {
    const promptText = ["Example: I always ask for feedback in writing, says the prompt."];
    const [check] = verifyItems([item("4", "I always ask for feedback in writing")], turns, promptText);
    expect(check).toMatchObject({ ok: false, reason: "substring_of_prompt" });
  });

  it("D21-T5: mergeVerified keeps the first call's items, adds new ones once, and stops at 40", () => {
    const first = [...verifyItems([item("4", "I always ask for feedback in writing")], turns, forbidden), ...verifyItems([item("6", "I always ask for feedback in writing")], turns, forbidden)];
    const second = verifyItems(
      [item("4", "I always ask for feedback in writing"), item("6", "I learn new tools by rebuilding something")],
      turns,
      forbidden,
    );
    const merged = mergeVerified(first, second);
    expect(merged.map((check) => check.turn.turnIndex)).toEqual([4, 6]);

    const many = Array.from({ length: 45 }, (unused, index) => turn(100 + index, `Note ${String(index)} about my quiet morning routine at home.`));
    const manyTurns = new Map(many.map((entry) => [entry.turnIndex, entry]));
    const checks: ItemCheck[] = verifyItems(
      many.map((entry) => item(String(entry.turnIndex), `Note ${String(entry.turnIndex - 100)} about my quiet morning routine`)),
      manyTurns,
      forbidden,
    );
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(mergeVerified(checks, [])).toHaveLength(40);
  });
});
