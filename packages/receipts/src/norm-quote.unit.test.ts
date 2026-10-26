import { describe, expect, it } from "vitest";
import { normQuote } from "./norm-quote.js";

describe("normQuote", () => {
  it("D24-T1: folds curly quotes and dashes to ASCII", () => {
    const curly = "\u201Cdon\u2019t \u2014 stop\u201D";

    const result = normQuote(curly);

    expect(result).toBe("don't - stop");
  });

  it("D24-T2: collapses ASCII whitespace runs to one space and trims", () => {
    const spaced = "  a \t\n b  ";

    const result = normQuote(spaced);

    expect(result).toBe("a b");
  });

  it("D24-T3: strips leading and trailing punctuation but keeps inner punctuation", () => {
    const wrapped = "...I think, so!";

    const result = normQuote(wrapped);

    expect(result).toBe("i think, so");
  });

  it("D24-T4: composes NFD to NFC before comparing", () => {
    const decomposed = "cafe\u0301";
    const composed = "caf\u00E9";

    const normalisedDecomposed = normQuote(decomposed);
    const normalisedComposed = normQuote(composed);

    expect(normalisedDecomposed).toBe(normalisedComposed);
  });

  it("D24-T5: leaves non-ASCII whitespace alone", () => {
    const ideographicSpace = "a\u3000b";

    const result = normQuote(ideographicSpace);

    expect(result).toBe("a\u3000b");
  });
});
