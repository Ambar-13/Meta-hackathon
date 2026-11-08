import { expect, it } from "vitest";
import { PUBLIC_PAGES } from "@meet-first/contracts";
import { renderPath } from "./entry-server.js";
import { PAGE_HEADS } from "./pages.js";

it("SEO-T6: the start page renders to HTML with its headline, its steps, its promises and real links to the policy pages", async () => {
  const html = await renderPath("/");

  expect(html).toContain("Your Meety");
  expect(html).toContain("next generation");
  expect(html).toContain("of social media,");
  expect(html).toContain("with context.");
  expect(html).toContain("People are more than profiles.");
  expect(html).toContain("No scores. No mind reading.");
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/cookies"');
  expect(html).toContain('class="app-frame"');
  expect(html).not.toContain("__staticRouterHydrationData");
});

it("SEO-T20: the start page's own words say what Meety is, a free social network where each person's Meety is an AI, so a search or answer engine can quote it", async () => {
  const text = (await renderPath("/")).replace(/<[^>]+>/g, " ");

  expect(text).toContain("Meety is a free social network.");
  expect(text).toMatch(/\bAI\b/);
});

it("SEO-T7: every public page renders with the line its head promises, and every head has a page", async () => {
  expect(PAGE_HEADS.map((head) => head.path)).toEqual(PUBLIC_PAGES.map((page) => page.path));
  for (const head of PAGE_HEADS) {
    const html = await renderPath(head.path);
    expect(html).toContain(head.mustContain);
    expect(head.title.length).toBeLessThanOrEqual(64);
    expect(head.description.length).toBeLessThanOrEqual(160);
  }
});
