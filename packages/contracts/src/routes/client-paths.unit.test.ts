import { expect, it } from "vitest";
import {
  CLIENT_PATH_PATTERNS,
  isClientPath,
  isIndexablePath,
  pathOf,
  PUBLIC_PAGES,
} from "./client-paths.js";

it("SEO-T1: pathOf keeps the path, drops the query and the fragment, and drops one trailing slash", () => {
  expect(pathOf("/")).toBe("/");
  expect(pathOf("/?access=abc")).toBe("/");
  expect(pathOf("/privacy/")).toBe("/privacy");
  expect(pathOf("/share/x7?utm=1#top")).toBe("/share/x7");
  expect(pathOf("/meetings/m1/brief")).toBe("/meetings/m1/brief");
});

it("SEO-T2: isClientPath is true for every pattern's shape and false for addresses the app has no screen for", () => {
  expect(isClientPath("/")).toBe(true);
  expect(isClientPath("/home")).toBe(true);
  expect(isClientPath("/share/abc")).toBe(true);
  expect(isClientPath("/meetings/7f1c/brief")).toBe(true);
  expect(isClientPath("/sources/s1/names")).toBe(true);
  expect(isClientPath("/share")).toBe(false);
  expect(isClientPath("/share/")).toBe(false);
  expect(isClientPath("/meetings/7f1c/nothing")).toBe(false);
  expect(isClientPath("/wp-admin")).toBe(false);
  expect(isClientPath("/index.html")).toBe(false);
  expect(isClientPath("/robots.txt")).toBe(false);
});

it("SEO-T3: every public page is a client path with its own file, and only public and share pages are indexable", () => {
  for (const page of PUBLIC_PAGES) {
    expect(isClientPath(page.path)).toBe(true);
    expect(CLIENT_PATH_PATTERNS).toContain(page.path);
    expect(page.changed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  expect(new Set(PUBLIC_PAGES.map((page) => page.file)).size).toBe(PUBLIC_PAGES.length);
  expect(isIndexablePath("/")).toBe(true);
  expect(isIndexablePath("/privacy")).toBe(true);
  expect(isIndexablePath("/share/abc")).toBe(true);
  expect(isIndexablePath("/home")).toBe(false);
  expect(isIndexablePath("/meetings/7f1c/share")).toBe(false);
});
