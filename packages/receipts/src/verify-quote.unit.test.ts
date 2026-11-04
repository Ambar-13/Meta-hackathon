import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normQuote } from "./norm-quote.js";
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
const MINIMUM_LENGTH_AND_PROMPT_FIXTURES = new Set([11, 12, 13, 14, 15, 19, 20, 21, 29]);
const SECOND_TURN_TEXT = "Then I cooked rice and went to bed.";

function loadFixture(fileName: string): Fixture {
  return JSON.parse(readFileSync(FIXTURE_FOLDER + fileName, "utf8")) as Fixture;
}

const cases = FIXTURE_NAMES.map((fileName, index) => {
  const fixture = loadFixture(fileName);
  const prefix = MINIMUM_LENGTH_AND_PROMPT_FIXTURES.has(index + 1) ? "D25" : "D26";
  return {
    fileName,
    title: `${prefix}-T${String(index + 1)}: ${fixture.name} gives ${fixture.expect}`,
  };
});

describe("verifyQuote over the 30 fixtures", () => {
  it.each(cases)("$title", ({ fileName }) => {
    const fixture = loadFixture(fileName);

    const result = verifyQuote({
      quote: fixture.quote,
      turnText: fixture.turnText,
      turnNormText: normQuote(fixture.turnText),
      forbidden: fixture.forbidden,
    });

    const outcome = result.ok ? "ok" : result.reason;
    expect(outcome).toBe(fixture.expect);
    const original = result.ok
      ? fixture.turnText.slice(result.originalStart, result.originalEnd)
      : undefined;
    if (fixture.expectOriginal !== undefined) expect(original).toBe(fixture.expectOriginal);
  });

  it("R6.2-T1: a quote spanning two turns fails inside either turn", () => {
    const fixture = loadFixture("two-turn-span.json");
    const turns = [fixture.turnText, SECOND_TURN_TEXT];

    const outcomes = turns.map((turnText) =>
      verifyQuote({
        quote: fixture.quote,
        turnText,
        turnNormText: normQuote(turnText),
        forbidden: fixture.forbidden,
      }),
    );

    expect(outcomes.map((result) => (result.ok ? "ok" : result.reason))).toEqual([
      "not_in_turn",
      "not_in_turn",
    ]);
  });

  it("R6.6-T1: the forbidden list is compared after normalisation", () => {
    const fixture = loadFixture("prompt-substring-case.json");

    const result = verifyQuote({
      quote: fixture.quote,
      turnText: fixture.turnText,
      turnNormText: normQuote(fixture.turnText),
      forbidden: fixture.forbidden,
    });

    expect(result.ok ? "ok" : result.reason).toBe("substring_of_prompt");
  });
});
