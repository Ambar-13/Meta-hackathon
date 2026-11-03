import { describe, expect, it } from "vitest";
import { postAgeWords } from "../people/index.js";
import { peopleRowAt } from "./explore-state.js";

describe("where the suggested people sit in the feed", () => {
  it("W7-SAMPLE-WEB-T6: after the second post, after the last when there are fewer, and first when there are none", () => {
    expect(peopleRowAt(5)).toBe(2);
    expect(peopleRowAt(2)).toBe(2);
    expect(peopleRowAt(1)).toBe(1);
    expect(peopleRowAt(0)).toBe(0);
  });
});

describe("a post's age in words", () => {
  const now = new Date("2026-11-03T12:00:00.000Z");
  const ago = (ms: number): string => postAgeWords(new Date(now.getTime() - ms).toISOString(), now);

  it("W7-SAMPLE-WEB-T7: a moment ago, minutes, hours and days, then the date; a time ahead of the clock is a moment ago", () => {
    expect(ago(20_000)).toBe("A moment ago");
    expect(ago(-60_000)).toBe("A moment ago");
    expect(ago(60_000)).toBe("1 minute ago");
    expect(ago(45 * 60_000)).toBe("45 minutes ago");
    expect(ago(3_600_000)).toBe("1 hour ago");
    expect(ago(23 * 3_600_000)).toBe("23 hours ago");
    expect(ago(2 * 86_400_000)).toBe("2 days ago");
    expect(ago(10 * 86_400_000)).toBe("Oct 24");
  });
});
