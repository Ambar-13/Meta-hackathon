import { expect, it } from "vitest";
import { hashToken, isPublicRoute, newHexToken } from "./cookie.js";
import { makeRecoveryCode } from "./create-person.js";
import { appOrigin, isOriginAllowed } from "./origin-check.js";

const ORIGIN = "http://localhost:3000";
const RECOVERY_CODE_PATTERN = /^[abcdefghjkmnpqrstuvwxyz23456789]{32}$/;

it("A5-T3: makeRecoveryCode gives 32 characters from the 31-symbol alphabet, all different across 1,000 codes", () => {
  const codes = Array.from({ length: 1000 }, () => makeRecoveryCode());

  for (const code of codes) {
    expect(code).toMatch(RECOVERY_CODE_PATTERN);
  }
  expect(new Set(codes).size).toBe(1000);
});

it("D33-T3: newHexToken gives 64 hex characters for 32 bytes and 32 for 16 bytes", () => {
  const longToken = newHexToken(32);
  const shortToken = newHexToken(16);

  expect(longToken).toMatch(/^[0-9a-f]{64}$/);
  expect(shortToken).toMatch(/^[0-9a-f]{32}$/);
  expect(newHexToken(32)).not.toBe(newHexToken(32));
});

it("D33-T4: hashToken is the 32-byte sha256 of the token text", () => {
  expect(hashToken("abc").toString("hex")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(hashToken("abc").length).toBe(32);
});

it("A7-T6: isPublicRoute matches the five public routes, counts HEAD as GET, and nothing else", () => {
  const publicCases: [string, string][] = [
    ["POST", "/api/people"],
    ["POST", "/api/sessions/recover"],
    ["POST", "/api/sessions/claim"],
    ["GET", "/api/health"],
    ["HEAD", "/api/health"],
    ["GET", "/api/share/:slug"],
  ];
  const privateCases: [string, string][] = [
    ["POST", "/api/sessions/transfer"],
    ["DELETE", "/api/people/me"],
    ["POST", "/api/pairs"],
    ["GET", "/api/pairs/:id"],
    ["GET", "/api/meetings/:id/events"],
    ["GET", "/api/people"],
  ];

  for (const [method, path] of publicCases) {
    expect(isPublicRoute(method, path)).toBe(true);
  }
  for (const [method, path] of privateCases) {
    expect(isPublicRoute(method, path)).toBe(false);
  }
});

it("A7-T7: isOriginAllowed passes GET and HEAD always and any other method only with the exact origin", () => {
  expect(isOriginAllowed("GET", undefined, ORIGIN)).toBe(true);
  expect(isOriginAllowed("HEAD", "http://evil.example", ORIGIN)).toBe(true);
  expect(isOriginAllowed("POST", ORIGIN, ORIGIN)).toBe(true);

  expect(isOriginAllowed("POST", undefined, ORIGIN)).toBe(false);
  expect(isOriginAllowed("POST", "http://evil.example", ORIGIN)).toBe(false);
  expect(isOriginAllowed("DELETE", "http://localhost:3001", ORIGIN)).toBe(false);
  expect(isOriginAllowed("OPTIONS", undefined, ORIGIN)).toBe(false);

  expect(appOrigin("https://meet.example/")).toBe("https://meet.example");
});
