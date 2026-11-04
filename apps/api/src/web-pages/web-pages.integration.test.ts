import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Health } from "@meet-first/contracts";
import { buildTestApp } from "../testing/app-factory.js";
import type { RoutePlugin } from "../app-types.js";
import { registerWebPages, registerWebPagesRoutes } from "./index.js";

const INDEX_HTML =
  '<!doctype html><html><head><title>Meet First</title></head><body><div id="root"></div></body></html>';
// The start page as prerender.ts writes it: the origin as the placeholder, the words in the root.
const START_PAGE_HTML =
  '<!doctype html><html><head><title>Meety - start</title><link rel="canonical" href="__APP_ORIGIN__/" /></head><body><div id="root"><h1>Your Meety meets theirs first.</h1><a href="__APP_ORIGIN__/og.png">picture</a></div></body></html>';
const PRIVACY_PAGE_HTML =
  '<!doctype html><html><head><title>Privacy</title></head><body><div id="root"><h1>Privacy</h1></div></body></html>';
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const HUGE_PLAN_BYTES = 1_000_000_000_000_000;
const MISSING_BUILD_SENTENCE =
  "The web app is not built yet. Run pnpm --filter web build, then restart the api.";

let distDir = "";
let emptyDir = "";
// The clock the health route reads; null means the real clock.
let fakeNow: Date | null = null;
let t1: Awaited<ReturnType<typeof buildTestApp>>;
let t2: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), "meet-first-web-"));
  await writeFile(join(distDir, "index.html"), INDEX_HTML);
  await writeFile(join(distDir, "favicon.svg"), FAVICON_SVG);
  await mkdir(join(distDir, "assets"));
  await writeFile(join(distDir, "assets", "app-1a2b3c4d.js"), 'console.log("meet first");');
  await mkdir(join(distDir, "prerendered"));
  await writeFile(join(distDir, "prerendered", "index.html"), START_PAGE_HTML);
  await writeFile(join(distDir, "prerendered", "privacy.html"), PRIVACY_PAGE_HTML);
  emptyDir = await mkdtemp(join(tmpdir(), "meet-first-empty-"));
  const webWithClock: RoutePlugin = (app, deps) =>
    registerWebPages(
      app,
      { ...deps, now: () => fakeNow ?? new Date() },
      { distDir, diskPlanBytes: HUGE_PLAN_BYTES },
    );
  const webWithoutBuild: RoutePlugin = (app, deps) =>
    registerWebPages(app, deps, { distDir: emptyDir, diskPlanBytes: 1 });
  t1 = await buildTestApp({ routes: [webWithClock] });
  t2 = await buildTestApp({ routes: [webWithoutBuild] });
});

afterAll(async () => {
  await t1.close();
  await t2.close();
  await rm(distDir, { recursive: true, force: true });
  await rm(emptyDir, { recursive: true, force: true });
});

it("A7-T5: client paths serve the built index.html with no-store, and hashed files are cached for a year", async () => {
  const paths = ["/home", "/share/abc", "/meetings/7f1c/brief"];
  const shells = [];
  for (const path of paths) {
    shells.push(await t1.app.inject({ method: "GET", url: path }));
  }
  const asset = await t1.app.inject({ method: "GET", url: "/assets/app-1a2b3c4d.js" });
  const missing = await t1.app.inject({ method: "GET", url: "/assets/missing-00000000.js" });

  for (const shell of shells) {
    expect(shell.statusCode).toBe(200);
    expect(shell.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(shell.headers["cache-control"]).toBe("no-store");
    expect(shell.body).toBe(INDEX_HTML);
  }
  expect(asset.statusCode).toBe(200);
  expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(asset.body).toBe('console.log("meet first");');
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toMatchObject({ code: "not_found" });
});

it("SEO-T12: a public page the build prerendered is served at its path with the origin in place of the placeholder, and without noindex", async () => {
  const start = await t1.app.inject({ method: "GET", url: "/" });
  const withQuery = await t1.app.inject({ method: "GET", url: "/?access=meetfirst-x" });
  const privacy = await t1.app.inject({ method: "GET", url: "/privacy" });
  const terms = await t1.app.inject({ method: "GET", url: "/terms" });

  for (const response of [start, withQuery]) {
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBeUndefined();
    expect(response.body).toContain('<link rel="canonical" href="http://localhost:3000/" />');
    expect(response.body).toContain("<h1>Your Meety meets theirs first.</h1>");
    expect(response.body).not.toContain("__APP_ORIGIN__");
  }
  expect(privacy.statusCode).toBe(200);
  expect(privacy.body).toBe(PRIVACY_PAGE_HTML);
  expect(terms.statusCode).toBe(200);
  expect(terms.body).toBe(INDEX_HTML);
  expect(terms.headers["x-robots-tag"]).toBeUndefined();
});

it("SEO-T13: pages that show nothing without a session carry noindex, share pages do not, and an address the app has no page for answers 404 with the shell", async () => {
  const home = await t1.app.inject({ method: "GET", url: "/home" });
  const share = await t1.app.inject({ method: "GET", url: "/share/abc" });
  const nowhere = await t1.app.inject({ method: "GET", url: "/wp-admin" });
  const halfShare = await t1.app.inject({ method: "GET", url: "/share/" });
  const deep = await t1.app.inject({ method: "GET", url: "/meetings/7f1c/nothing?x=1" });

  expect(home.statusCode).toBe(200);
  expect(home.headers["x-robots-tag"]).toBe("noindex");
  expect(share.statusCode).toBe(200);
  expect(share.headers["x-robots-tag"]).toBeUndefined();
  for (const response of [nowhere, deep]) {
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["x-robots-tag"]).toBe("noindex");
    expect(response.body).toBe(INDEX_HTML);
  }
  expect(halfShare.statusCode).toBe(301);
  expect(halfShare.headers.location).toBe("/share");
});

it("SEO-T14: a trailing slash redirects for good to the address without it, query kept", async () => {
  const privacy = await t1.app.inject({ method: "GET", url: "/privacy/" });
  const home = await t1.app.inject({ method: "GET", url: "/home/?tab=posts" });
  const root = await t1.app.inject({ method: "GET", url: "/" });

  expect(privacy.statusCode).toBe(301);
  expect(privacy.headers.location).toBe("/privacy");
  expect(home.statusCode).toBe(301);
  expect(home.headers.location).toBe("/home?tab=posts");
  expect(root.statusCode).toBe(200);
});

it("SEO-T16: a trailing-slash address that starts with two slashes redirects on this site, never to another", async () => {
  // Written as full addresses, because a path that starts with two slashes would otherwise be
  // read as a host by the test client; a real request sends the path as typed.
  const twoSlashes = await t1.app.inject({
    method: "GET",
    url: "http://localhost:3000//evil.example/",
  });
  const backslash = await t1.app.inject({
    method: "GET",
    url: "http://localhost:3000/\\evil.example/",
  });

  for (const response of [twoSlashes, backslash]) {
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("/evil.example");
  }
});

it("SEO-T15: robots.txt, sitemap.xml and the root files are served with their types and a one-day cache", async () => {
  const robots = await t1.app.inject({ method: "GET", url: "/robots.txt" });
  const sitemap = await t1.app.inject({ method: "GET", url: "/sitemap.xml" });
  const favicon = await t1.app.inject({ method: "GET", url: "/favicon.svg" });
  const noPicture = await t1.app.inject({ method: "GET", url: "/og.png" });

  expect(robots.statusCode).toBe(200);
  expect(robots.headers["content-type"]).toBe("text/plain; charset=utf-8");
  expect(robots.headers["cache-control"]).toBe("public, max-age=86400");
  expect(robots.body).toContain("User-agent: OAI-SearchBot\n");
  expect(robots.body).toContain("Sitemap: http://localhost:3000/sitemap.xml");
  expect(sitemap.statusCode).toBe(200);
  expect(sitemap.headers["content-type"]).toBe("application/xml; charset=utf-8");
  expect(sitemap.body).toContain("<loc>http://localhost:3000/privacy</loc>");
  expect(favicon.statusCode).toBe(200);
  expect(favicon.headers["content-type"]).toBe("image/svg+xml");
  expect(favicon.body).toBe(FAVICON_SVG);
  expect(noPicture.statusCode).toBe(404);
  expect(noPicture.headers["content-type"]).toBe("text/html; charset=utf-8");
});

it("R9.4-T1: an /api path no route claims answers a JSON 404, never the app shell", async () => {
  const share = await t1.app.inject({ method: "GET", url: "/api/share/not-a-real-slug" });
  const bare = await t1.app.inject({ method: "GET", url: "/api" });
  const post = await t1.app.inject({
    method: "POST",
    url: "/api/nothing",
    headers: { origin: "http://localhost:3000" },
  });

  for (const response of [share, bare, post]) {
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.json()).toEqual({
      code: "not_found",
      message: "This no longer exists or is not yours.",
    });
  }
});

it("A7-T8: with no web build the shell answers 503 web_build_missing, robots.txt still answers, and health still works", async () => {
  const root = await t2.app.inject({ method: "GET", url: "/" });
  const share = await t2.app.inject({ method: "GET", url: "/share/x" });
  const robots = await t2.app.inject({ method: "GET", url: "/robots.txt" });
  const health = await t2.app.inject({ method: "GET", url: "/api/health" });

  for (const response of [root, share]) {
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "web_build_missing", message: MISSING_BUILD_SENTENCE });
  }
  expect(robots.statusCode).toBe(200);
  expect(health.statusCode).toBe(200);
});

it("R12.5-T1: health on a fresh database reports db true, worker false from the seeded heartbeat, and no disk pressure", async () => {
  fakeNow = null;

  const r = await t1.app.inject({ method: "GET", url: "/api/health" });
  const body = Health.parse(r.json());

  expect(r.statusCode).toBe(200);
  expect(body.db).toBe(true);
  expect(body.worker).toBe(false);
  expect(body.schemaVersion).toBeGreaterThanOrEqual(1);
  expect(body.diskPct).toBe(0);
  expect(body.degraded).toBe(false);
  expect(body.ok).toBe(false);
});

it("R12.5-T2: worker is true under 120 s after the heartbeat and false at 120 s (uses a fake clock)", async () => {
  fakeNow = new Date(119_000);
  const under = Health.parse((await t1.app.inject({ method: "GET", url: "/api/health" })).json());
  fakeNow = new Date(120_000);
  const atLimit = Health.parse((await t1.app.inject({ method: "GET", url: "/api/health" })).json());
  fakeNow = null;

  expect(under.worker).toBe(true);
  expect(under.ok).toBe(true);
  expect(atLimit.worker).toBe(false);
  expect(atLimit.ok).toBe(false);
});

it("R12.5-T3: a database at 80% or more of the plan's disk is degraded and not ok", async () => {
  const r = await t2.app.inject({ method: "GET", url: "/api/health" });
  const body = Health.parse(r.json());

  expect(body.db).toBe(true);
  expect(body.diskPct).toBe(100);
  expect(body.degraded).toBe(true);
  expect(body.ok).toBe(false);
});

it("R12.5-T7: the deployed health route measures the database against DATABASE_DISK_BYTES", async () => {
  const t3 = await buildTestApp({
    routes: [registerWebPagesRoutes],
    env: { DATABASE_DISK_BYTES: 1_000_000 },
  });
  try {
    const body = Health.parse((await t3.app.inject({ method: "GET", url: "/api/health" })).json());

    expect(body.diskPct).toBe(100);
    expect(body.degraded).toBe(true);
  } finally {
    await t3.close();
  }
});
