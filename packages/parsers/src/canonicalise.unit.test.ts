import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalise, guessLang } from "./canonicalise.js";
import { extractOwnTurns } from "./extract-own-turns.js";

// Reads one fixture file from packages/parsers/fixtures as text.
async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

describe("canonicalise", () => {
  it("D6-T1: strips a leading BOM, turns CRLF and a lone CR into LF, and composes to NFC", () => {
    expect(canonicalise("﻿a\r\nb\rc é")).toBe("a\nb\nc é");
  });

  it("D6-T2: removes format and control characters but keeps line feeds and tabs", () => {
    expect(canonicalise("x​y‮z\u0007w\tv\nu­t")).toBe("xyzw\tv\nut");
  });

  it("R7.7-T1: the hidden-characters fixture loses U+200B, U+202E and U+FEFF", async () => {
    const text = await fixture("hidden-characters.txt");
    const result = extractOwnTurns([{ name: "hidden-characters.txt", text }], null);
    expect(result.kind).toBe("paste");
    expect(result.turns.map((turn) => turn.text)).toEqual([
      "Iam not here",
      "The second note has a zero width space and a byte order mark inside.",
      "The third note is plain.",
    ]);
    for (const turn of result.turns) {
      expect(turn.text).not.toContain("​");
      expect(turn.text).not.toContain("‮");
      expect(turn.text).not.toContain("﻿");
      expect(turn.text).not.toContain("\r");
    }
  });

  it("D7-T1: canonical text is stable and keeps an emoji as two code units", () => {
    const text = canonicalise("I cried \u{1F602} at the café.");
    expect(text).toBe("I cried \u{1F602} at the café.");
    expect(text.length).toBe(23);
    expect(canonicalise(text)).toBe(text);
  });

  it("R1.1-T20: guessLang labels Latin, Devanagari and Tamil text", () => {
    expect(guessLang("I work best before nine in the morning.")).toBe("en");
    expect(guessLang("मैं हर सुबह जल्दी उठता हूँ और पार्क में लंबी सैर पर जाता हूँ")).toBe("hi");
    expect(guessLang("நான் தினமும் காலையில் சீக்கிரம் எழுந்து நடக்கிறேன்")).toBe("ta");
  });

  it("R1.1-T21: guessLang tells Japanese from Chinese by the kana", () => {
    expect(guessLang("私は毎朝早く起きて散歩に行きます。週末は図書館で本を読みます。")).toBe("ja");
    expect(guessLang("我每天早上很早起床然后去公园散步再去图书馆看书学习")).toBe("zh");
  });

  it("R1.1-T22: fewer than 20 letters is und", () => {
    expect(guessLang("短い")).toBe("und");
    expect(guessLang("print(1)")).toBe("und");
  });
});
