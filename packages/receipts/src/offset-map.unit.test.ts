import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normQuote } from "./norm-quote.js";
import { buildOffsetMap, originalSlice } from "./offset-map.js";
import { verifyQuote } from "./verify-quote.js";

type Fixture = {
  name: string;
  turnText: string;
  quote: string;
  forbidden: string[];
  expect: string;
  expectOriginal?: string;
};

const FIXTURE_FOLDER = fileURLToPath(new URL("../fixtures/quotes/", import.meta.url));
const FIXTURE_NAMES = [
  "plain-ascii",
  "curly-quotes",
  "curly-quotes-reverse",
  "case-differs",
  "whitespace-collapsed",
  "trailing-period",
  "leading-quote-mark",
  "em-dash-to-hyphen",
  "nfc-vs-nfd",
  "two-turn-span",
  "too-short-19",
  "exactly-20",
  "cjk-10-code-points",
  "cjk-9-code-points",
  "cjk-with-surrogates",
  "hindi-devanagari",
  "hindi-danda-trimmed",
  "tamil",
  "prompt-substring",
  "question-substring",
  "prompt-substring-case",
  "paraphrase",
  "reordered-words",
  "quote-with-ellipsis",
  "redaction-placeholder-inside",
  "code-fence-placeholder",
  "emoji-inside",
  "offset-map-original",
  "empty-quote",
  "turn-shorter-than-quote",
].map((name) => `${name}.json`);

function loadFixture(fileName: string): Fixture {
  return JSON.parse(readFileSync(FIXTURE_FOLDER + fileName, "utf8")) as Fixture;
}

describe("offset map", () => {
  it("D7-T1: offset map normalised text equals normQuote for every fixture", () => {
    const fixtures = FIXTURE_NAMES.map(loadFixture);

    const mismatches = fixtures.filter(
      (fixture) => buildOffsetMap(fixture.turnText).normalised !== normQuote(fixture.turnText),
    );

    expect(mismatches.map((fixture) => fixture.name)).toEqual([]);
  });

  it("D7-T2: original slice restores curly quotes and the line break", () => {
    const fixture = loadFixture("offset-map-original.json");
    const result = verifyQuote({
      quote: fixture.quote,
      turnText: fixture.turnText,
      turnNormText: normQuote(fixture.turnText),
      forbidden: fixture.forbidden,
    });
    if (!result.ok) throw new Error(`fixture should verify, got ${result.reason}`);

    const slice = originalSlice(buildOffsetMap(fixture.turnText), result.normStart, result.normEnd);

    expect(slice.text).toBe(fixture.expectOriginal);
  });

  it("D7-T3: offsets are UTF-16 code units across an emoji", () => {
    const fixture = loadFixture("emoji-inside.json");
    const result = verifyQuote({
      quote: fixture.quote,
      turnText: fixture.turnText,
      turnNormText: normQuote(fixture.turnText),
      forbidden: fixture.forbidden,
    });
    if (!result.ok) throw new Error(`fixture should verify, got ${result.reason}`);

    const width = result.originalEnd - result.originalStart;

    expect(width).toBe(fixture.expectOriginal?.length);
  });
});
