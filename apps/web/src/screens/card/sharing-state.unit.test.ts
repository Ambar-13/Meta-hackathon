import { describe, expect, it } from "vitest";
import { MyListing } from "@meet-first/contracts";
import {
  draftFromSaved,
  LINE_REFUSAL,
  NO_PUBLIC_ITEM_REFUSAL,
  planSharingSave,
  type SavedSharing,
  type SharingDraft,
} from "./sharing-state.js";

// The card these plans are for, a second card of the same person, and the person's listing.
const CARD_ID = "00000000-0000-4000-8000-000000000111";
const OTHER_CARD_ID = "00000000-0000-4000-8000-000000000112";
const LISTING_ID = "00000000-0000-4000-8000-000000000501";
// What the server holds when nothing is shared and the person is not listed.
const NOTHING_SAVED: SavedSharing = {
  sharing: { friendsCanAsk: false, publicPositions: [] },
  listing: null,
};

// The person's listing on one card, with the given line and dating switch, and item 1 public.
function listingOn(cardId: string, line: string, isOpen: boolean): MyListing {
  return MyListing.parse({
    listingId: LISTING_ID,
    cardId,
    line,
    openToRomance: isOpen,
    items: [
      { kind: "value", claim: "Claim number 1", quote: "I said this in my own words, number 1" },
    ],
    createdAt: "2026-10-27T10:00:00.000Z",
  });
}

// An all-off draft with the given fields set.
function draftWith(fields: Partial<SharingDraft>): SharingDraft {
  return {
    friendsCanAsk: false,
    publicPositions: new Set<number>(),
    isListed: false,
    line: "",
    openToRomance: false,
    ...fields,
  };
}

// A draft with its positions as a sorted list, so toEqual can compare it.
function comparable(
  draft: SharingDraft,
): Omit<SharingDraft, "publicPositions"> & { publicPositions: number[] } {
  return {
    ...draft,
    publicPositions: [...draft.publicPositions].sort((first, second) => first - second),
  };
}

describe("sharing save plan", () => {
  it("W6-DWEB-T1 (design section 7): a draft with the directory on and a blank or 141-character line is refused with the line sentence", () => {
    const base = { cardId: CARD_ID, saved: NOTHING_SAVED };

    const blank = planSharingSave({
      ...base,
      draft: draftWith({ isListed: true, line: "   ", publicPositions: new Set([1]) }),
    });
    const tooLong = planSharingSave({
      ...base,
      draft: draftWith({ isListed: true, line: "x".repeat(141), publicPositions: new Set([1]) }),
    });
    const longest = planSharingSave({
      ...base,
      draft: draftWith({ isListed: true, line: "x".repeat(140), publicPositions: new Set([1]) }),
    });

    expect(blank).toEqual({ kind: "refused", sentence: LINE_REFUSAL });
    expect(tooLong).toEqual({ kind: "refused", sentence: LINE_REFUSAL });
    expect(longest.kind).toBe("send");
  });

  it("W6-DWEB-T2 (P1, P2): a draft with the directory on and no public item is refused with the public item sentence", () => {
    const draft = draftWith({ isListed: true, line: "Builds hackathon tools" });

    const plan = planSharingSave({ cardId: CARD_ID, saved: NOTHING_SAVED, draft });

    expect(plan).toEqual({ kind: "refused", sentence: NO_PUBLIC_ITEM_REFUSAL });
  });

  it("W6-DWEB-T3 (P2): leaving sends the DELETE first and no listing, and staying listed with the same line and switch sends no listing", () => {
    const saved: SavedSharing = {
      sharing: { friendsCanAsk: false, publicPositions: [1] },
      listing: listingOn(CARD_ID, "Builds hackathon tools", true),
    };

    const leaving = planSharingSave({
      cardId: CARD_ID,
      saved,
      draft: draftWith({
        isListed: false,
        line: "Builds hackathon tools",
        publicPositions: new Set([1]),
      }),
    });
    const staying = planSharingSave({
      cardId: CARD_ID,
      saved,
      draft: draftWith({
        isListed: true,
        line: " Builds hackathon tools ",
        openToRomance: true,
        publicPositions: new Set([1]),
      }),
    });

    expect(leaving).toEqual({
      kind: "send",
      isLeavingFirst: true,
      sharing: { friendsCanAsk: false, publicPositions: [1] },
      listing: null,
    });
    expect(staying).toEqual({
      kind: "send",
      isLeavingFirst: false,
      sharing: { friendsCanAsk: false, publicPositions: [1] },
      listing: null,
    });
  });

  it("W6-DWEB-T4 (P2, P8): a new listing, a changed line, a changed dating switch and a listing on another card each send the listing with the trimmed line", () => {
    const listedHere: SavedSharing = {
      sharing: { friendsCanAsk: false, publicPositions: [1] },
      listing: listingOn(CARD_ID, "Builds hackathon tools", false),
    };
    const listedElsewhere: SavedSharing = {
      ...listedHere,
      listing: listingOn(OTHER_CARD_ID, "Builds hackathon tools", false),
    };
    const draft = draftWith({
      isListed: true,
      line: "  Builds hackathon tools ",
      publicPositions: new Set([1]),
    });

    const fresh = planSharingSave({ cardId: CARD_ID, saved: NOTHING_SAVED, draft });
    const newLine = planSharingSave({
      cardId: CARD_ID,
      saved: listedHere,
      draft: { ...draft, line: "Plans every week" },
    });
    const newSwitch = planSharingSave({
      cardId: CARD_ID,
      saved: listedHere,
      draft: { ...draft, openToRomance: true },
    });
    const moved = planSharingSave({ cardId: CARD_ID, saved: listedElsewhere, draft });

    expect(fresh).toMatchObject({
      kind: "send",
      isLeavingFirst: false,
      listing: { cardId: CARD_ID, line: "Builds hackathon tools", openToRomance: false },
    });
    expect(newLine).toMatchObject({
      kind: "send",
      listing: { cardId: CARD_ID, line: "Plans every week", openToRomance: false },
    });
    expect(newSwitch).toMatchObject({
      kind: "send",
      listing: { cardId: CARD_ID, line: "Builds hackathon tools", openToRomance: true },
    });
    expect(moved).toMatchObject({
      kind: "send",
      isLeavingFirst: false,
      listing: { cardId: CARD_ID, line: "Builds hackathon tools", openToRomance: false },
    });
  });

  it("W6-DWEB-T5 (design section 6): the public positions are sent in ascending order", () => {
    const draft = draftWith({ publicPositions: new Set([6, 1, 4]) });

    const plan = planSharingSave({ cardId: CARD_ID, saved: NOTHING_SAVED, draft });

    expect(plan).toEqual({
      kind: "send",
      isLeavingFirst: false,
      sharing: { friendsCanAsk: false, publicPositions: [1, 4, 6] },
      listing: null,
    });
  });

  it("W6-DWEB-T6 (design section 7, P8): draftFromSaved starts every control off when nothing is shared, and keeps the dating switch off for a listing on another card", () => {
    const shared = { friendsCanAsk: true, publicPositions: [2] };

    const empty = draftFromSaved(NOTHING_SAVED, CARD_ID);
    const elsewhere = draftFromSaved(
      { sharing: shared, listing: listingOn(OTHER_CARD_ID, "Builds hackathon tools", true) },
      CARD_ID,
    );
    const here = draftFromSaved(
      { sharing: shared, listing: listingOn(CARD_ID, "Builds hackathon tools", true) },
      CARD_ID,
    );

    expect(comparable(empty)).toEqual({
      friendsCanAsk: false,
      publicPositions: [],
      isListed: false,
      line: "",
      openToRomance: false,
    });
    expect(comparable(elsewhere)).toEqual({
      friendsCanAsk: true,
      publicPositions: [2],
      isListed: false,
      line: "Builds hackathon tools",
      openToRomance: false,
    });
    expect(comparable(here)).toEqual({
      friendsCanAsk: true,
      publicPositions: [2],
      isListed: true,
      line: "Builds hackathon tools",
      openToRomance: true,
    });
  });
});
