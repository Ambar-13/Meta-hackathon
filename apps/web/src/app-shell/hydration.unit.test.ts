import { expect, it } from "vitest";
import { canHydrate } from "./hydration.js";

it("SEO-T17: a prerendered page is hydrated only at its bare address; a query or a fragment renders it from nothing", () => {
  expect(canHydrate("", "")).toBe(true);
  expect(canHydrate("?access=meetfirst-j493y6", "")).toBe(false);
  expect(canHydrate("?google=cancelled", "")).toBe(false);
  expect(canHydrate("", "#steps")).toBe(false);
  expect(canHydrate("?x=1", "#top")).toBe(false);
});
