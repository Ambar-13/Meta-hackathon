import { describe, expect, it } from "vitest";
import { normQuote } from "@meet-first/receipts";
import { CardBuildOutput, toStrictJsonSchema } from "@meet-first/contracts";
import { readPrompt } from "@meet-first/prompts";
import { formatTurnBlock } from "./name-chunks.js";
import { cardCall, cardRegenerationCall, keywordsOf, sampleTurns, type SampledTurn } from "./turn-sampler.js";

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

// The words of one diversity turn: turns 0 and 4 add new keywords, the rest repeat the same three words.
function diversityBase(index: number): string {
  if (index === 0) return "orchid lantern harbor alpha beta gamma";
  if (index === 4) return "violin meadow quartz alpha beta gamma";
  return "alpha beta gamma";
}

// Ten turns of 94 characters each, so every block costs 102 with its separator. Turns 0 and 4 add new keywords.
const DIVERSITY_SET: SampledTurn[] = Array.from({ length: 10 }, (unused, index) => {
  return turn(index, diversityBase(index).padEnd(94, "."));
});

// The indexes of a list of turns, in the order given.
function indexesOf(turns: readonly SampledTurn[]): number[] {
  return turns.map((item) => item.turnIndex);
}

describe("sampleTurns", () => {
  it("D19-T1: a source under the cap is sent whole in turn order", () => {
    const picked = sampleTurns([turn(2, "c"), turn(0, "a"), turn(1, "b")], 600_000);
    expect(indexesOf(picked)).toEqual([0, 1, 2]);
  });

  it("D19-T2: over the cap, the newest turn fills the first half and the two turns with new keywords fill the rest", () => {
    const picked = sampleTurns(DIVERSITY_SET, 400);
    expect(indexesOf(picked)).toEqual([0, 4, 9]);
    expect(picked.map(formatTurnBlock).join("\n\n")).toHaveLength(304);
  });

  it("D19-T3: turns that add no new keyword wait for the fill step, newest first", () => {
    const picked = sampleTurns(DIVERSITY_SET, 600);
    expect(indexesOf(picked)).toEqual([0, 4, 7, 8, 9]);
    expect(picked.map(formatTurnBlock).join("\n\n")).toHaveLength(508);
  });

  it("D19-T4: the joined blocks never pass maxChars", () => {
    const turns = Array.from({ length: 50 }, (unused, index) =>
      turn(
        index,
        Array.from({ length: 200 }, (unused, k) => `w${String(index)}x${String(k)}`)
          .join(" ")
          .slice(0, ((index * 37) % 500) + 50)
          .trim(),
      ),
    );
    const picked = sampleTurns(turns, 5000);
    expect(picked).toHaveLength(15);
    const indexes = indexesOf(picked);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    expect(picked.map(formatTurnBlock).join("\n\n")).toHaveLength(4989);
  });

  it("R3.3-T2: a Tamil source of 800,000 characters is cut to whole turns within 600,000 and estimates under 1,048,576 tokens", () => {
    const text = "நான் காலையில் ஆறு மணிக்கு எழுகிறேன். ".repeat(10).slice(0, 200);
    const turns = Array.from({ length: 4000 }, (unused, index) => turn(index, text));
    const picked = sampleTurns(turns, 600_000);
    expect(picked).toHaveLength(2843);
    const joined = picked.map(formatTurnBlock).join("\n\n");
    expect(joined).toHaveLength(599_871);
    expect(Math.ceil(599_871 / 1.33)).toBeLessThan(1_048_576);
  });
});

describe("keywordsOf and the card requests", () => {
  it("D19-T5: keywords are lower-case runs of 3 or more characters minus stop words, and 2-character windows in Chinese", () => {
    expect([...keywordsOf("The Plan, the PLAN and 2026 goals. [redacted:email:3f9a1c2e] 下周开会")].sort()).toEqual([
      "2026",
      "goals",
      "plan",
      "下周",
      "周开",
      "开会",
    ]);
  });

  it("D21-T3: the card call sends the dossier prompt with the rules and the turns in label order", () => {
    const call = cardCall([turn(5, "b"), turn(2, "a")]);
    expect(call.callSite).toBe("card");
    expect(call.promptVersion).toBe("v1");
    expect(call.messages[0]).toEqual({
      role: "system",
      content: `${readPrompt("dossier").text}\n\n${readPrompt("untrusted-data-rules").text}`,
    });
    expect(call.messages[1]).toEqual({ role: "user", content: "<source_turns>\n[t:2] a\n\n[t:5] b\n</source_turns>" });
    expect(call.schema).toEqual(toStrictJsonSchema(CardBuildOutput, "dossier"));
  });

  it("D27-T1: the regeneration call adds the first reply and one line per failed item", () => {
    const call = cardCall([turn(5, "b"), turn(2, "a")]);
    const regeneration = cardRegenerationCall(call, '{"items":[]}', [
      {
        ok: false,
        position: 7,
        item: { kind: "habit", claim: "c", lang: "en", gloss: "c", turn_id: "6", quote: "q" },
        reason: "not_in_turn",
      },
    ]);
    expect(regeneration.messages).toHaveLength(4);
    expect(regeneration.messages[2]).toEqual({ role: "assistant", content: '{"items":[]}' });
    expect(regeneration.messages[3]?.content).toBe('<failed_items>\nitem 7: turn_id "6", reason not_in_turn\n</failed_items>');
    expect(regeneration.callSite).toBe(call.callSite);
    expect(regeneration.promptVersion).toBe(call.promptVersion);
    expect(regeneration.schema).toEqual(call.schema);
  });
});
