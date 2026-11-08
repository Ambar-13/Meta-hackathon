import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { headOf, SHARE_IMAGE, SHARE_TAG_KEYS, withoutShellShareTags } from "./head.js";
import { ORIGIN_PLACEHOLDER, PAGE_HEADS } from "./pages.js";

// The app shell as the web build starts from it.
const SHELL = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

// The content of one meta tag by its name or property, or null when the HTML lacks it.
function contentOf(html: string, key: string): string | null {
  const tag = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html);
  return tag === null ? null : (tag[1] ?? null);
}

it("SEO-T18: the app shell carries every share tag a link preview reads, with the start page's words and no address of its own", () => {
  const start = PAGE_HEADS[0];
  expect(SHARE_TAG_KEYS.filter((key) => contentOf(SHELL, key) === null)).toEqual([]);
  expect(contentOf(SHELL, "og:title")).toBe(start?.shareTitle);
  expect(contentOf(SHELL, "description")).toBe(start?.description);
  expect(contentOf(SHELL, "og:image")).toBe(`${ORIGIN_PLACEHOLDER}${SHARE_IMAGE.path}`);
  expect(contentOf(SHELL, "og:url")).toBeNull();
});

it("SEO-T19: every public page's head carries every share tag and its own address, and the shell's own share tags make way for it", () => {
  const bare = withoutShellShareTags(SHELL);
  expect(bare).not.toMatch(/(?:og|twitter):/);
  expect(contentOf(bare, "description")).toBeNull();
  expect(bare).toContain("<title>Meety</title>");
  for (const page of PAGE_HEADS) {
    const head = headOf(page);
    expect(SHARE_TAG_KEYS.filter((key) => contentOf(head, key) === null)).toEqual([]);
    expect(contentOf(head, "og:url")).toBe(`${ORIGIN_PLACEHOLDER}${page.path}`);
    expect(contentOf(head, "og:image")).toBe(`${ORIGIN_PLACEHOLDER}${SHARE_IMAGE.path}`);
  }
});

it("SEO-T22: the share picture's address carries a version and its words describe the start page, so a link preview fetches the new picture instead of a cached one and reads it right", () => {
  expect(SHARE_IMAGE.path).toMatch(/^\/og\.png\?v=\d+$/);
  expect(SHARE_IMAGE.alt).toContain("The next generation of social media, with context.");
  expect(contentOf(SHELL, "og:image:alt")).toBe(SHARE_IMAGE.alt);
  expect(contentOf(SHELL, "twitter:image:alt")).toBe(SHARE_IMAGE.alt);
});
