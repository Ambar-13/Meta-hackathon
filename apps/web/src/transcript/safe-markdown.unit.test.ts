import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseSafeMarkdown, SafeMarkdown } from "./safe-markdown.js";

// The static HTML of the allow-list renderer for one text.
function html(text: string): string {
  return renderToStaticMarkup(createElement(SafeMarkdown, { text }));
}

describe("safe markdown", () => {
  it("D66-T1: markdown renders no link, image or HTML", () => {
    const markup = html("Read [this](http://evil.test) and ![x](http://evil.test/a.png) <img src=x>");
    expect(markup).toBe('<div class="safe-markdown"><p>Read [this](http://evil.test) and ![x](http://evil.test/a.png) &lt;img src=x&gt;</p></div>');
    for (const banned of ["<a", "<img", " href=\"", " src=\""]) {
      expect(markup).not.toContain(banned);
    }
  });

  it("R7.2-T1: an image link in model text never becomes an element that loads a URL", () => {
    expect(html("![a](https://evil.test/x.png?q=card)")).toBe('<div class="safe-markdown"><p>![a](https://evil.test/x.png?q=card)</p></div>');
  });

  it("D66-T2: emphasis, strong, lists and quotes render as em, strong, ul, ol, li and blockquote", () => {
    expect(html("**bold** and *soft*\n\n- one\n- two\n\n1. first\n\n> said")).toBe(
      '<div class="safe-markdown"><p><strong>bold</strong> and <em>soft</em></p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><blockquote><p>said</p></blockquote></div>',
    );
  });

  it("D66-T3: headings, code and underscores stay as typed", () => {
    expect(html("# Title\n\n`code` and _soft_")).toBe('<div class="safe-markdown"><p># Title</p><p>`code` and _soft_</p></div>');
  });

  it("D66-T4: parseSafeMarkdown joins paragraph and quote lines with one space", () => {
    expect(parseSafeMarkdown("one\ntwo\n\n> said\n> more")).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "one two" }] },
      { kind: "quote", inlines: [{ kind: "text", text: "said more" }] },
    ]);
  });
});
