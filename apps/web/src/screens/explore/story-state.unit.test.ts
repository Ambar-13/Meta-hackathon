import { describe, expect, it } from "vitest";
import type { Story } from "@meet-first/contracts";
import { storyGroups } from "./story-state.js";

// One story by one person, n hours ago; listing n names the person.
function story(input: { id: number; listing: number | null; name: string; hoursAgo: number; isMine?: boolean; isSample?: boolean }): Story {
  return {
    storyId: `00000000-0000-4000-8000-0000000007${String(input.id).padStart(2, "0")}`,
    listingId: input.listing === null ? null : `00000000-0000-4000-8000-0000000006${String(input.listing).padStart(2, "0")}`,
    displayName: input.name, isSample: input.isSample === true, isMine: input.isMine === true, authorPhoto: null, text: "", photo: null, photoAlt: null,
    createdAt: new Date(Date.UTC(2026, 10, 3, 12) - input.hoursAgo * 3_600_000).toISOString(), expiresAt: null,
  };
}

describe("the row of stories", () => {
  it("W7-STORY-U1: your own come first, then new ones before watched ones, real before sample and friends first, each person's oldest first", () => {
    const stories = [
      story({ id: 1, listing: null, name: "You", hoursAgo: 1, isMine: true }),
      story({ id: 2, listing: 1, name: "Ravi", hoursAgo: 2 }),
      story({ id: 3, listing: 2, name: "Jun", hoursAgo: 3 }),
      story({ id: 4, listing: 1, name: "Ravi", hoursAgo: 5 }),
      story({ id: 5, listing: 3, name: "Maya", hoursAgo: 6, isSample: true }),
      story({ id: 6, listing: 4, name: "Leila", hoursAgo: 7 }),
    ];
    const friendListing = stories[2]?.listingId;
    const seen = new Set([stories[5]?.storyId ?? ""]);
    const groups = storyGroups(stories, (listingId) => listingId === friendListing, seen);

    expect(groups.map((group) => [group.displayName, group.isSeen])).toEqual([["You", false], ["Jun", false], ["Ravi", false], ["Maya", false], ["Leila", true]]);
    expect(groups[2]?.stories.map((item) => item.storyId)).toEqual([stories[3]?.storyId, stories[1]?.storyId]);
    expect(storyGroups([], () => true, new Set())).toEqual([]);
  });
});
