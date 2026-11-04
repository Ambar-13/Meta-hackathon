import { describe, expect, it } from "vitest";
import { postAgeWords } from "../people/index.js";
import type { DirectoryListing, Post } from "@meet-first/contracts";
import { keyWords, noteItemFor, peopleRowAt } from "./explore-state.js";

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

// Jun's listing with three public items, and one of Jun's posts with this text.
const JUN: DirectoryListing = {
  listingId: "00000000-0000-4000-8000-000000000601",
  displayName: "Jun",
  line: "First hackathon.",
  openToRomance: false,
  isSample: true,
  items: [
    {
      kind: "goal",
      claim: "Came to the hackathon to meet people more than to win",
      quote: "I came to meet people more than to win",
    },
    {
      kind: "habit",
      claim: "Builds small robots at home",
      quote: "I build small robots at home, mostly with an Arduino",
    },
    {
      kind: "preference",
      claim: "Will own the hardware on a team",
      quote: "If the team needs hardware, I will own it",
    },
  ],
};
function junPost(text: string): Post {
  return {
    postId: "00000000-0000-4000-8000-000000000602",
    listingId: JUN.listingId,
    displayName: "Jun",
    isSample: true,
    text,
    createdAt: "2026-11-03T00:00:00.000Z",
  };
}

describe("the line under a post, from what its writer shared", () => {
  it("W7-NOTE-T1: picks the item sharing the most words, the first on a tie, and none when no word is shared or the writer is not loaded", () => {
    expect(
      noteItemFor(
        junPost("Looking for a team that needs someone to own the hardware. I bring an Arduino."),
        JUN,
      )?.claim,
    ).toBe("Will own the hardware on a team");
    expect(
      noteItemFor(junPost("Got a two-wheel robot to follow a line tonight."), JUN)?.claim,
    ).toBe("Builds small robots at home");
    expect(noteItemFor(junPost("Great coffee this morning."), JUN)).toBeNull();
    expect(noteItemFor(junPost("Looking for a team"), undefined)).toBeNull();
  });

  it("W7-NOTE-T2: key words are four letters or more, not common, without a plural s, and never the writer's own name", () => {
    expect([...keyWords("Draw the three screens before you write any code")]).toEqual([
      "draw",
      "three",
      "screen",
      "write",
      "code",
    ]);
    expect(
      noteItemFor(junPost("Jun says hello."), {
        ...JUN,
        items: [{ kind: "habit", claim: "Jun likes tea", quote: "Jun here" }],
      }),
    ).toBeNull();
  });
});
