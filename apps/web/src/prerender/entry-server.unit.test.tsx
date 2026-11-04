import { expect, it } from "vitest";
import { PUBLIC_PAGES } from "@meet-first/contracts";
import { renderPath } from "./entry-server.js";
import { PAGE_HEADS } from "./pages.js";

it("SEO-T6: the start page renders to HTML with its headline, its steps, its promises and real links to the policy pages", async () => {
  const html = await renderPath("/");

  expect(html).toContain("Your Meety");
  expect(html).toContain("meets");
  expect(html).toContain("Three steps to your first brief.");
  expect(html).toContain("It never scores anyone.");
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/cookies"');
  expect(html).toContain('class="app-frame"');
  expect(html).not.toContain("__staticRouterHydrationData");
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
