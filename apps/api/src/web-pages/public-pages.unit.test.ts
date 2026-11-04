import { expect, it } from "vitest";
import { PUBLIC_PAGES } from "@meet-first/contracts";
import { ANSWER_BOTS, originOf, robotsText, sitemapXml } from "./public-pages.js";
import { withoutTrailingSlash } from "./spa-fallback.js";

it("SEO-T8: originOf keeps scheme, host and port and drops a trailing slash or path", () => {
  expect(originOf("https://meet-first.onrender.com/")).toBe("https://meet-first.onrender.com");
  expect(originOf("http://localhost:3000")).toBe("http://localhost:3000");
  expect(originOf("https://heymeety.com/anything")).toBe("https://heymeety.com");
});

it("SEO-T9: robots.txt names every answer bot in one group, allows every page but the api in both groups, and names the sitemap", () => {
  const text = robotsText("https://example.test");
  const groups = text.trim().split("\n\n");

  expect(groups).toHaveLength(3);
  for (const bot of ANSWER_BOTS) expect(groups[0]).toContain(`User-agent: ${bot}\n`);
  expect(groups[0]).toMatch(/Disallow: \/api\/\nAllow: \/$/);
  expect(groups[1]).toBe("User-agent: *\nDisallow: /api/\nAllow: /");
  expect(groups[2]).toBe("Sitemap: https://example.test/sitemap.xml");
  expect(text).not.toContain("Disallow: /\n");
});

it("SEO-T10: sitemap.xml lists each public page once with its origin and the day its words changed", () => {
  const xml = sitemapXml("https://example.test");

  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(xml.match(/<url>/g)).toHaveLength(PUBLIC_PAGES.length);
  for (const page of PUBLIC_PAGES) {
    expect(xml).toContain(`<loc>https://example.test${page.path}</loc>`);
    expect(xml).toContain(`<lastmod>${page.changed}</lastmod>`);
  }
  expect(xml).not.toContain("/share/");
});

it("SEO-T11: withoutTrailingSlash drops the slash, keeps the query and the fragment, and never points off the site", () => {
  expect(withoutTrailingSlash("/privacy/")).toBe("/privacy");
  expect(withoutTrailingSlash("/privacy/?x=1")).toBe("/privacy?x=1");
  expect(withoutTrailingSlash("/share/abc/#top")).toBe("/share/abc#top");
  expect(withoutTrailingSlash("//evil.example/")).toBe("/evil.example");
  expect(withoutTrailingSlash("///evil.example/?x=1")).toBe("/evil.example?x=1");
  expect(withoutTrailingSlash("/\\evil.example/")).toBe("/evil.example");
  expect(withoutTrailingSlash("/\\/evil.example/")).toBe("/evil.example");
});
