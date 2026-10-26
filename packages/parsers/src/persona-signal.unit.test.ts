import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PERSONA_SIGNAL_LOW } from "@meet-first/contracts";
import { canonicalise } from "./canonicalise.js";
import { computePersonaSignal, personaScore } from "./persona-signal.js";

// The shape of the code-only fixture: one conversation with a list of messages.
type CodeOnlyFile = Array<{ messages: Array<{ role: string; content: string }> }>;

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

describe("persona signal", () => {
  it("R3.8-T1: the code-only fixture scores 0.115, under the low-signal line", async () => {
    const raw = await readFile(new URL("../fixtures/code-only.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as CodeOnlyFile;
    const texts = itemAt(parsed, 0)
      .messages.filter((message) => message.role === "user")
      .map((message) => canonicalise(message.content));
    expect(texts.length).toBe(30);
    expect(computePersonaSignal(texts)).toBe(0.115);
    expect(computePersonaSignal(texts)).toBeLessThan(PERSONA_SIGNAL_LOW);
  });

  it("R3.8-T2: personaScore is 1.5, 1, 0.5 or 0", () => {
    expect(personaScore("I keep rewriting my CV because I never feel it says who I am.")).toBe(1.5);
    expect(personaScore("I am tired.")).toBe(1);
    expect(personaScore("The train leaves at seven from platform two.")).toBe(0.5);
    expect(personaScore("```js\nconst x = 1;\n```")).toBe(0);
  });

  it("R3.8-T3: a curly apostrophe matches the straight one", () => {
    expect(personaScore("Hier soir j’ai fini le livre que tu aimes tant.")).toBe(1.5);
  });

  it("R3.8-T4: Han characters count as words and pronouns match as substrings", () => {
    expect(personaScore("我每天早上很早起床")).toBe(1.5);
  });

  it("R3.8-T5: no prose turn gives 0, and the share is rounded to 3 decimals", () => {
    expect(computePersonaSignal(["short one", "two words"])).toBe(0);
    expect(
      computePersonaSignal([
        "I walked to the shop and back again.",
        "The shop was closed for the holiday today.",
        "The bus came late again this whole week.",
      ]),
    ).toBe(0.333);
  });
});
