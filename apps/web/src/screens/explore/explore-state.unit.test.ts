import { describe, expect, it } from "vitest";
import type { DirectoryListing, Post } from "@meet-first/contracts";
import { postAgeWords } from "../people/index.js";
import { mixTiles } from "./explore-state.js";

// A listing or a post known by one name.
function person(name: string): DirectoryListing {
  return { listingId: `00000000-0000-4000-8000-0000000006${name.length.toString().padStart(2, "0")}`, displayName: name, line: "A line", openToRomance: false, isSample: false, items: [] };
}
function post(text: string): Post {
  return { postId: "00000000-0000-4000-8000-000000000601", listingId: "00000000-0000-4000-8000-000000000602", displayName: "Ann", isSample: true, text, createdAt: "2026-11-03T00:00:00.000Z" };
}
// The tiles as names and post words, in order.
function names(people: DirectoryListing[], posts: Post[]): string[] {
  return mixTiles(people, posts).map((tile) => (tile.kind === "person" ? tile.listing.displayName : tile.post.text));
}

describe("the Explore grid's order", () => {
  it("W7-SAMPLE-WEB-T6: two people, then a post, and the rest of either list once the other runs out; a last person before a post is alone", () => {
    expect(names([person("Ann"), person("Bo"), person("Cy")], [post("p1"), post("p2"), post("p3")])).toEqual(["Ann", "Bo", "p1", "Cy", "p2", "p3"]);
    expect(names([person("Ann"), person("Bo"), person("Cy"), person("Di"), person("Ed")], [post("p1")])).toEqual(["Ann", "Bo", "p1", "Cy", "Di", "Ed"]);
    expect(names([], [post("p1"), post("p2")])).toEqual(["p1", "p2"]);
    expect(names([person("Ann")], [])).toEqual(["Ann"]);
    const alone = mixTiles([person("Ann"), person("Bo"), person("Cy")], [post("p1"), post("p2")]).flatMap((tile) => (tile.kind === "person" ? [tile.isAlone] : []));
    expect(alone).toEqual([false, false, true]);
    expect(mixTiles([person("Ann"), person("Bo"), person("Cy")], []).some((tile) => tile.kind === "person" && tile.isAlone)).toBe(false);
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
