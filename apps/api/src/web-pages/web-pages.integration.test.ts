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
  await mkdir(join(distDir, "assets"));
  await writeFile(join(distDir, "assets", "app-1a2b3c4d.js"), 'console.log("meet first");');
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

it("A7-T5: GET / and client paths serve the built index.html with no-store, and hashed files are cached for a year", async () => {
  const paths = ["/", "/share/abc", "/meetings/7f1c/brief"];
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

it("A7-T8: with no web build the shell answers 503 web_build_missing, and health still works", async () => {
  const root = await t2.app.inject({ method: "GET", url: "/" });
  const share = await t2.app.inject({ method: "GET", url: "/share/x" });
  const health = await t2.app.inject({ method: "GET", url: "/api/health" });

  for (const response of [root, share]) {
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "web_build_missing", message: MISSING_BUILD_SENTENCE });
  }
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
