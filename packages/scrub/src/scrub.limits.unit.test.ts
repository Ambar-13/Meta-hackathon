import { beforeAll, describe, expect, it } from "vitest";
import { scrub } from "./scrub.js";

// The time one scrub of a text takes, in milliseconds (the text is scrubbed once, with an empty allowlist).
function timeScrub(text: string): number {
  const start = performance.now();
  scrub(text, { allowlist: [] });
  return performance.now() - start;
}

// A text of the given length made by repeating one unit, cut to the length.
function repeated(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

describe("URL passwords with punctuation", () => {
  it("R2.2-T18: a password holding a slash is replaced whole, as url_credentials", () => {
    const result = scrub("postgres://user:pa/ss@host/db now.", { allowlist: [] });
    expect(result.text).toBe("[redacted:url_credentials:00000001] now.");
    expect(result.redactions).toEqual([{ category: "url_credentials", placeholderId: "00000001" }]);
  });

  it("R2.2-T19: a password holding a hash is replaced whole, as url_credentials", () => {
    expect(scrub("postgres://user:pa#ss@host/db now.", { allowlist: [] }).text).toBe("[redacted:url_credentials:00000001] now.");
  });

  it("R2.2-T20: a password holding a question mark is replaced whole, as url_credentials", () => {
    expect(scrub("postgres://user:pa?ss@host/db now.", { allowlist: [] }).text).toBe("[redacted:url_credentials:00000001] now.");
  });

  it("R2.2-T21: a short URL with a slash in the password is caught by the URL rule, not left to the entropy rule", () => {
    const result = scrub("http://u:p/w@h.co now.", { allowlist: [] });
    expect(result.text).toBe("[redacted:url_credentials:00000001] now.");
    expect(result.redactions[0]?.category).toBe("url_credentials");
  });
});

describe("slow inputs stay fast", () => {
  // The first scrub of a process pays for the regular expressions' setup, so it is made before any timing.
  beforeAll(() => {
    scrub("warm up", { allowlist: [] });
  });

  it("R2.2-T22: a 20,000-character run of capitals and underscores with no = scrubs in under 50 ms", () => {
    const text = repeated("ABCDEFGHIJKLMNOPQRSTUVWXYZ_", 20_000);
    expect(timeScrub(text)).toBeLessThan(50);
  });

  it("R2.2-T23: a 20,000-character run of a: with no :// scrubs in under 50 ms", () => {
    const text = repeated("a:", 20_000);
    expect(timeScrub(text)).toBeLessThan(50);
  });

  it("R2.2-T24: a 20,000-character run of name characters with an @ after a space scrubs in under 50 ms", () => {
    const text = "a".repeat(20_000) + " @x";
    expect(timeScrub(text)).toBeLessThan(50);
  });

  it("R2.2-T25: a 20,000-character run of scheme repeats with no @ scrubs in under 50 ms", () => {
    const text = repeated("x://u:", 20_000);
    expect(timeScrub(text)).toBeLessThan(50);
  });
});
