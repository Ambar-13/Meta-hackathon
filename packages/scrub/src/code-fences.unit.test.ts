import { describe, expect, it } from "vitest";
import { replaceCodeFences } from "./code-fences.js";
import type { Segment } from "./placeholders.js";

// The text of every segment joined in order.
function joined(segments: Segment[]): string {
  return segments.map((segment) => segment.text).join("");
}

describe("replaceCodeFences", () => {
  it("D13-T1: a closed fence becomes one placeholder line with its language and line count", () => {
    expect(replaceCodeFences("Before\n```python\nprint(1)\nprint(2)\n```\nAfter")).toEqual([
      { text: "Before\n", isProtected: false, category: null },
      { text: "[code: python, 2 lines]", isProtected: true, category: "code" },
      { text: "\nAfter", isProtected: false, category: null },
    ]);
  });

  it("D13-T2: an unclosed fence runs to the end of the text", () => {
    expect(joined(replaceCodeFences("Look:\n```\nSECRET=1\nmore"))).toBe(
      "Look:\n[code: text, 2 lines]",
    );
  });

  it("D13-T3: a tilde fence closes only with at least as many tildes", () => {
    expect(joined(replaceCodeFences("~~~~ js\nx\n~~~~~\nend"))).toBe("[code: js, 1 lines]\nend");
  });

  it("D13-T4: a bad language word becomes text and an empty fence counts 0 lines", () => {
    expect(joined(replaceCodeFences("```Weird$Lang\nx\n```"))).toBe("[code: text, 1 lines]");
    expect(joined(replaceCodeFences("```\n```"))).toBe("[code: text, 0 lines]");
  });

  it("D13-T5: four spaces of indent is no fence, and tildes do not close backticks", () => {
    expect(replaceCodeFences("    ```\n    x")).toEqual([
      { text: "    ```\n    x", isProtected: false, category: null },
    ]);
    expect(joined(replaceCodeFences("```\nx\n~~~\ny\n```"))).toBe("[code: text, 3 lines]");
  });
});
