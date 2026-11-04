import { beforeAll, describe, expect, it } from "vitest";
import { scrub } from "./scrub.js";

// How many times a timed scrub runs. The fastest run is kept, because other test files share the CPU while these run, and a
// slow run tells nothing about the scrubber itself.
const TIMED_RUNS = 3;

// One scrub of a text: the scrubbed text, its redactions, and the fastest of TIMED_RUNS scrubs in milliseconds.
function scrubTimed(text: string): {
  text: string;
  redactions: Array<{ category: string; placeholderId: string }>;
  ms: number;
} {
  let fastest = Number.POSITIVE_INFINITY;
  let result = scrub(text, { allowlist: [] });
  for (let run = 0; run < TIMED_RUNS; run += 1) {
    const start = performance.now();
    result = scrub(text, { allowlist: [] });
    fastest = Math.min(fastest, performance.now() - start);
  }
  return { ...result, ms: fastest };
}

// The fastest time of the timed runs of one text, in milliseconds.
function timeScrub(text: string): number {
  return scrubTimed(text).ms;
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
    expect(scrub("postgres://user:pa#ss@host/db now.", { allowlist: [] }).text).toBe(
      "[redacted:url_credentials:00000001] now.",
    );
  });

  it("R2.2-T20: a password holding a question mark is replaced whole, as url_credentials", () => {
    expect(scrub("postgres://user:pa?ss@host/db now.", { allowlist: [] }).text).toBe(
      "[redacted:url_credentials:00000001] now.",
    );
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

  it("R2.2-T29: a 20,000-character run of A= scrubs in under 50 ms and changes nothing, since no name holds a secret word", () => {
    const text = repeated("A=", 20_000);
    const result = scrubTimed(text);
    expect(result.text).toBe(text);
    expect(result.ms).toBeLessThan(50);
  });

  it('R2.2-T30: a 20,000-character run of A=" scrubs in under 50 ms and changes nothing', () => {
    const text = repeated('A="', 20_000);
    const result = scrubTimed(text);
    expect(result.text).toBe(text);
    expect(result.ms).toBeLessThan(50);
  });

  it("R2.2-T31: A= followed by one 20,000-character run of non-space characters scrubs in under 50 ms", () => {
    const text = "A=" + "x".repeat(20_000 - 2);
    const result = scrubTimed(text);
    expect(result.text).toBe(text);
    expect(result.ms).toBeLessThan(50);
  });

  it("R2.2-T32: a bare secret value over 1,024 characters is redacted whole, with nothing after the placeholder", () => {
    const value = "x".repeat(20_000 - "PASSWORD=".length);
    const result = scrubTimed("PASSWORD=" + value);
    expect(result.ms).toBeLessThan(50);
    expect(result.redactions).toEqual([{ category: "secret", placeholderId: "00000001" }]);
    expect(result.text).toBe("PASSWORD=[redacted:secret:00000001]");
  });

  it("R2.2-T35: a quoted secret value over 1,024 characters is redacted whole, through its closing quote", () => {
    const value = "x".repeat(20_000 - 'PASSWORD="'.length - 1);
    const result = scrubTimed('PASSWORD="' + value + '"');
    expect(result.ms).toBeLessThan(50);
    expect(result.redactions).toEqual([{ category: "secret", placeholderId: "00000001" }]);
    expect(result.text).toBe("PASSWORD=[redacted:secret:00000001]");
  });

  it("R2.2-T36: a quoted value with no closing quote is redacted to the end of its line, and the line break and the next line are kept", () => {
    const text = 'PASSWORD="' + "x".repeat(20_000 - 'PASSWORD="'.length) + "\nnext line here";
    const result = scrubTimed(text);
    expect(result.ms).toBeLessThan(50);
    expect(result.redactions).toEqual([{ category: "secret", placeholderId: "00000001" }]);
    expect(result.text).toBe("PASSWORD=[redacted:secret:00000001]\nnext line here");
  });

  it('R2.2-T39: PASSWORD=" plus A= repeated, with no closing quote, scrubs in under 50 ms and is redacted to the end of the text', () => {
    const result = scrubTimed('PASSWORD="' + repeated("A=", 20_000 - 'PASSWORD="'.length));
    expect(result.ms).toBeLessThan(50);
    expect(result.text).toBe("PASSWORD=[redacted:secret:00000001]");
  });

  it("R2.2-T40: a run of unclosed quoted values, one per line, scrubs in under 50 ms and keeps every line break", () => {
    const text = ('PASSWORD="' + "x".repeat(89) + "\n").repeat(200);
    const result = scrubTimed(text);
    expect(result.ms).toBeLessThan(50);
    const lines = result.text.split("\n");
    expect(lines.length).toBe(text.split("\n").length);
    expect(
      lines.every((piece) => /^PASSWORD=\[redacted:secret:[0-9a-f]{8}\]$|^$/.test(piece)),
    ).toBe(true);
  });

  it('R2.2-T37: PASSWORD=" repeated scrubs in under 50 ms, with each quoted value redacted through its closing quote', () => {
    const result = scrubTimed(repeated('PASSWORD="', 20_000));
    expect(result.ms).toBeLessThan(50);
    expect(result.text).not.toContain('"');
    expect(result.redactions.every((redaction) => redaction.category === "secret")).toBe(true);
  });

  it("R2.2-T38: PASSWORD= repeated scrubs in under 50 ms, as one placeholder covering the whole run", () => {
    const result = scrubTimed(repeated("PASSWORD=", 20_000));
    expect(result.ms).toBeLessThan(50);
    expect(result.text).toBe("PASSWORD=[redacted:secret:00000001]");
  });

  it("R2.2-T33: a secret value of exactly 1,024 characters is redacted whole", () => {
    const value = "q".repeat(1_024);
    expect(scrub("PASSWORD=" + value, { allowlist: [] }).text).toBe(
      "PASSWORD=[redacted:secret:00000001]",
    );
  });

  it("R2.2-T34: a rejected name resumes at its own end, so a secret setting after it is still redacted", () => {
    expect(scrub("A=A=A=PASSWORD=abcdefgh", { allowlist: [] }).text).toBe(
      "A=A=A=PASSWORD=[redacted:secret:00000001]",
    );
  });
});
