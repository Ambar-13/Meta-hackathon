import { expect, it } from "vitest";
import { CLIENT_PATH_PATTERNS, PUBLIC_PAGES } from "@meet-first/contracts";
import { ROUTE_PATTERNS } from "./app-paths.js";

it("SEO-T4: the route patterns and contracts' client path list are the same set, so the api answers 404 exactly where the app has no page", () => {
  expect([...Object.values(ROUTE_PATTERNS)].sort()).toEqual([...CLIENT_PATH_PATTERNS].sort());
});

it("SEO-T5: every public page the api prerenders is a route of the app", () => {
  for (const page of PUBLIC_PAGES) {
    expect(Object.values(ROUTE_PATTERNS)).toContain(page.path);
  }
});
