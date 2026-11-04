import { expect, it } from "vitest";
import { diskPercent, isDiskDegraded, isWorkerFresh, toHealth } from "./health.js";
import { isApiPath } from "./spa-fallback.js";
import {
  ANALYTICS_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
  policyForHost,
} from "./static-files.js";

it("R12.5-T4: diskPercent rounds to one decimal and caps at 100, and 80 is degraded while 79.9 is not", () => {
  expect(diskPercent(8_000_000_000, 10_000_000_000)).toBe(80);
  expect(isDiskDegraded(80)).toBe(true);
  expect(diskPercent(7_990_000_000, 10_000_000_000)).toBe(79.9);
  expect(isDiskDegraded(79.9)).toBe(false);
  expect(diskPercent(20_000_000_000, 10_000_000_000)).toBe(100);
  expect(diskPercent(1, 3)).toBe(33.3);
  expect(isDiskDegraded(null)).toBe(false);
});

it("R12.5-T5: isWorkerFresh is true under 120 s and false at 120 s or with no heartbeat", () => {
  expect(isWorkerFresh(new Date(0), new Date(119_999))).toBe(true);
  expect(isWorkerFresh(new Date(0), new Date(120_000))).toBe(false);
  expect(isWorkerFresh(null, new Date(0))).toBe(false);
});

it("R12.5-T6: toHealth reports db false when the reads failed, and ok only with a fresh worker and a disk under 80%", () => {
  expect(toHealth(null, new Date(0), 10_000_000_000)).toEqual({
    ok: false,
    db: false,
    worker: false,
    schemaVersion: 0,
    diskPct: null,
    degraded: false,
  });
  expect(
    toHealth(
      { schemaVersion: 1, workerSeenAt: new Date(0), databaseBytes: 1_000 },
      new Date(60_000),
      10_000_000_000,
    ),
  ).toEqual({
    ok: true,
    db: true,
    worker: true,
    schemaVersion: 1,
    diskPct: 0,
    degraded: false,
  });
  expect(
    toHealth(
      { schemaVersion: 1, workerSeenAt: new Date(0), databaseBytes: 9_000_000_000 },
      new Date(60_000),
      10_000_000_000,
    ),
  ).toEqual({
    ok: false,
    db: true,
    worker: true,
    schemaVersion: 1,
    diskPct: 90,
    degraded: true,
  });
});

it("R9.4-T2: isApiPath is true for /api, /api/... and /api?... and false for client paths", () => {
  expect(isApiPath("/api")).toBe(true);
  expect(isApiPath("/api/share/x")).toBe(true);
  expect(isApiPath("/api?x=1")).toBe(true);
  expect(isApiPath("/apiary")).toBe(false);
  expect(isApiPath("/share/x")).toBe(false);
  expect(isApiPath("/")).toBe(false);
  expect(isApiPath("/assets/app.js")).toBe(false);
});

it("D67-T3: only the live host gets the Google Analytics policy, whatever the case or port, and it lets in no other site's script or image", () => {
  expect(policyForHost("heymeety.com")).toBe(ANALYTICS_CONTENT_SECURITY_POLICY);
  expect(policyForHost("HeyMeety.com:443")).toBe(ANALYTICS_CONTENT_SECURITY_POLICY);
  expect(policyForHost("meet-first.onrender.com")).toBe(CONTENT_SECURITY_POLICY);
  expect(policyForHost("localhost:3000")).toBe(CONTENT_SECURITY_POLICY);
  expect(policyForHost("heymeety.com.evil.example")).toBe(CONTENT_SECURITY_POLICY);
  expect(policyForHost(undefined)).toBe(CONTENT_SECURITY_POLICY);
  expect(ANALYTICS_CONTENT_SECURITY_POLICY).not.toContain("script-src");
  expect(ANALYTICS_CONTENT_SECURITY_POLICY).not.toContain("googletagmanager");
  expect(ANALYTICS_CONTENT_SECURITY_POLICY).toContain("default-src 'self'; img-src 'self' data:;");
});
