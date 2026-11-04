import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildTestApp } from "../testing/app-factory.js";
import type { RoutePlugin } from "../app-types.js";
import { registerSessionsRoutes } from "../sessions/index.js";
import { registerWebPages } from "./index.js";

const POLICY = "default-src 'self'; img-src 'self' data:; connect-src 'self'";
const LIVE_POLICY =
  "default-src 'self'; img-src 'self' data:; connect-src 'self' https://www.google-analytics.com";
const INDEX_HTML =
  '<!doctype html><html><head><title>Meet First</title></head><body><div id="root"></div></body></html>';

let distDir = "";
let t: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), "meet-first-web-"));
  await writeFile(join(distDir, "index.html"), INDEX_HTML);
  await mkdir(join(distDir, "assets"));
  await writeFile(join(distDir, "assets", "app-1a2b3c4d.js"), 'console.log("meet first");');
  const webRoutes: RoutePlugin = (app, deps) =>
    registerWebPages(app, deps, { distDir, diskPlanBytes: 1_000_000_000_000_000 });
  t = await buildTestApp({ routes: [registerSessionsRoutes, webRoutes] });
});

afterAll(async () => {
  await t.close();
  await rm(distDir, { recursive: true, force: true });
});

it("D67-T1: every response through Fastify carries exactly the D67 Content-Security-Policy", async () => {
  const responses = [
    await t.app.inject({ method: "GET", url: "/" }),
    await t.app.inject({ method: "GET", url: "/api/health" }),
    await t.app.inject({ method: "GET", url: "/api/nothing" }),
    await t.app.inject({ method: "GET", url: "/assets/app-1a2b3c4d.js" }),
    await t.app.inject({
      method: "POST",
      url: "/api/people",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ displayName: "X" }),
    }),
  ];

  expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 404, 200, 403]);
  for (const response of responses) {
    expect(response.headers["content-security-policy"]).toBe(POLICY);
  }
});

it("D67-T2: on heymeety.com the policy also lets Google Analytics' page views out, and scripts and images stay our own", async () => {
  const live = await t.app.inject({ method: "GET", url: "/", headers: { host: "heymeety.com" } });
  const api = await t.app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: "heymeety.com" },
  });
  const local = await t.app.inject({ method: "GET", url: "/" });

  expect(live.headers["content-security-policy"]).toBe(LIVE_POLICY);
  expect(api.headers["content-security-policy"]).toBe(LIVE_POLICY);
  expect(local.headers["content-security-policy"]).toBe(POLICY);
});
