import { describe, expect, it } from "vitest";
import { DirectoryListing, Friend } from "../directory/directory.js";
import { PhotoKey } from "../primitives.js";
import { Post } from "./posts.js";
import { ProfileView } from "./profile.js";

// One listing, one friend and one post as the api sent them before photos, so each still reads
// without them.
const LISTING = {
  listingId: "00000000-0000-4000-8000-000000000611",
  displayName: "Maya",
  line: "Angel investor.",
  openToRomance: false,
  isSample: true,
  items: [],
};
const FRIEND = {
  pairId: "00000000-0000-4000-8000-000000000612",
  displayName: "Maya",
  canAsk: true,
  listingId: LISTING.listingId,
};
const POST = {
  postId: "00000000-0000-4000-8000-000000000613",
  listingId: LISTING.listingId,
  displayName: "Maya",
  isSample: true,
  text: "A post.",
  createdAt: "2026-11-03T00:00:00.000Z",
};

describe("photos in the contracts", () => {
  it("W7-PHOTO-T8: a photo key is a plain lower-case name, or one under faces/ or photos/, of 64 characters at most; anything else is refused", () => {
    for (const key of [
      "faces/maya",
      "jun-robot",
      "a",
      "photos/0f3c2a1e-8d4b-4c6f-9a7e-2b1d5c8e9f00",
    ])
      expect(PhotoKey.safeParse(key).success).toBe(true);
    for (const key of [
      "",
      "Faces/Maya",
      "../secrets",
      "faces/",
      "faces/maya/x",
      "photos/",
      "photos/../x",
      "uploads/a",
      "https://example.com/a.jpg",
      "jun robot",
      "a".repeat(65),
    ]) {
      expect(PhotoKey.safeParse(key).success).toBe(false);
    }
  });

  it("W7-PHOTO-T9: a listing, a friend, a profile and a post read with their photos or without them, and the words for a photo stop at 300 characters", () => {
    const profile = {
      ...LISTING,
      friendship: "none",
      requestId: null,
      pairId: null,
      canAsk: false,
    };

    expect(DirectoryListing.parse(LISTING).photo).toBeUndefined();
    expect(DirectoryListing.parse({ ...LISTING, photo: "faces/maya" }).photo).toBe("faces/maya");
    expect(Friend.parse(FRIEND).isSample).toBeUndefined();
    expect(Friend.parse({ ...FRIEND, isSample: true, photo: "faces/maya" })).toMatchObject({
      isSample: true,
      photo: "faces/maya",
    });
    expect(ProfileView.safeParse(profile).success).toBe(true);
    expect(ProfileView.parse({ ...profile, photo: null }).photo).toBeNull();
    expect(Post.parse(POST).photo).toBeUndefined();
    expect(
      Post.parse({
        ...POST,
        authorPhoto: "faces/maya",
        photo: "maya-morning",
        photoAlt: "A latte.",
      }),
    ).toMatchObject({ authorPhoto: "faces/maya", photo: "maya-morning", photoAlt: "A latte." });
    expect(
      Post.safeParse({ ...POST, photo: "maya-morning", photoAlt: "a".repeat(301) }).success,
    ).toBe(false);
    expect(Post.safeParse({ ...POST, photo: "https://example.com/a.jpg" }).success).toBe(false);
  });
});
