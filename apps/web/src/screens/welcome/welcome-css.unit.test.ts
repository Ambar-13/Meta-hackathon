import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// app.css loads after every screen's stylesheet (start-app.tsx imports the routes first), so a
// welcome rule that resizes the shared name tag wins only when it out-ranks .tag, one class: a tie
// goes to app.css's small tag. jsdom cannot check this, since its cascade follows order alone.
const css = readFileSync(join(import.meta.dirname, "welcome.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

// Each style rule's selectors and declarations, rules inside @media included.
const RULES = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: (match[1] ?? "").split(",").map((part) => part.trim()),
  body: match[2] ?? "",
}));

describe("welcome name tag styles", () => {
  it("W7-WELCOME-T1: every rule that sizes the sign-up name tag out-ranks the shared .tag rule", () => {
    const sizing = RULES.filter((rule) => /(?:^|;)\s*(?:width|flex)\s*:/.test(rule.body)).flatMap(
      (rule) => rule.selectors.filter((selector) => selector.endsWith(".wl-formtag")),
    );
    expect(sizing).not.toHaveLength(0);
    expect(sizing.filter((selector) => (selector.match(/\./g) ?? []).length < 2)).toEqual([]);
  });
});
