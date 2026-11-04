import { describe, expect, it } from "vitest";
import { NamesPassOutput, toStrictJsonSchema } from "@meet-first/contracts";
import { readPrompt } from "@meet-first/prompts";
import { chunkTurnsForNames, formatTurnBlock, namesPassCall } from "./name-chunks.js";

// The eight messages of the names-none case.
const NAMES_NONE_TURNS = [
  "I write my to-do list by hand because typing it makes me ignore it.",
  "Mornings are for deep work and afternoons are for meetings.",
  "I take a ten-minute walk after every long call.",
  "I keep one notebook per project and number every page.",
  "When I am stuck, I explain the problem out loud to an empty room.",
  "I leave my phone in another room when I write.",
  "Every Friday I tidy my desk and plan the first task for Monday.",
  "I would rather finish one thing than start three.",
];

describe("chunkTurnsForNames", () => {
  it("D15-T2: six turns of 18,999 characters make one chunk of five turns and one of the sixth", () => {
    const turns = [0, 1, 2, 3, 4, 5].map((turnIndex) => ({
      turnIndex,
      text: "word ".repeat(3800).trimEnd(),
    }));
    const chunks = chunkTurnsForNames(turns);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.turnIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(chunks[0]?.text.length).toBe(95033);
    expect(chunks[1]?.turnIndexes).toEqual([5]);
    expect(chunks[1]?.text.length).toBe(19005);
  });

  it("D15-T3: turns are chunked in turn_index order whatever the input order", () => {
    const chunks = chunkTurnsForNames([
      { turnIndex: 2, text: "c" },
      { turnIndex: 0, text: "a" },
      { turnIndex: 1, text: "b" },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.turnIndexes).toEqual([0, 1, 2]);
    expect(chunks[0]?.text).toBe("[t:0] a\n\n[t:1] b\n\n[t:2] c");
  });

  it("D15-T4: no turns make no chunks", () => {
    expect(chunkTurnsForNames([])).toEqual([]);
  });

  it("R2.6-T1: a 40-line paste of 8 turns is one chunk", () => {
    const chunks = chunkTurnsForNames(
      NAMES_NONE_TURNS.map((text, turnIndex) => ({ turnIndex, text })),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.turnIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("namesPassCall", () => {
  it("D17-T1: the names-pass call holds the allowlist and the chunk in the user message", () => {
    const call = namesPassCall({ allowlist: ["Tom", "Kopi Club"], chunkText: "[t:0] hi" });
    expect(call.callSite).toBe("scrub_names");
    expect(call.promptVersion).toBe("v1");
    expect(call.messages[0]).toEqual({
      role: "system",
      content: `${readPrompt("scrub-names").text}\n\n${readPrompt("untrusted-data-rules").text}`,
    });
    expect(call.messages[1]).toEqual({
      role: "user",
      content:
        "<allowlist>\nTom\nKopi Club\n</allowlist>\n<source_turns>\n[t:0] hi\n</source_turns>",
    });
    expect(call.schema).toEqual(toStrictJsonSchema(NamesPassOutput, "scrub-names"));
  });

  it("D21-T2: a turn block is its label, a space and its text", () => {
    expect(formatTurnBlock({ turnIndex: 12, text: "Hello" })).toBe("[t:12] Hello");
  });
});
