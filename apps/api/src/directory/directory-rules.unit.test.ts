import { describe, expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import { assertCanShare } from "./card-sharing.js";
import { toDirectoryPage, type BrowseRow } from "./browse-and-friends.js";
import { toListingMeetingError } from "./create-listing-meeting.js";

// The code, status and sentence a check throws, or null when it throws nothing.
function refusalOf(run: () => void): { code: string; status: number; message: string } | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof ContractError) return { code: error.code, status: error.httpStatus, message: error.message };
    throw error;
  }
}

// Browse row number n, whose listing id ends in n written with two digits.
function browseRow(n: number): BrowseRow {
  return { listing_id: "00000000-0000-4000-8000-0000000000" + String(n).padStart(2, "0"), display_name: "Row " + String(n), line: "Line " + String(n), open_to_romance: n === 1, is_sample: n === 2, items: [{ kind: "goal", claim: "c", quote: "q" }] };
}

describe("directory rules", () => {
  it("W6-DAPI-T1 (design section 6): toDirectoryPage keeps the first 20 of 21 rows, maps every field, and says a next page exists", () => {
    const rows = Array.from({ length: 21 }, (value, index) => browseRow(index + 1));

    const full = toDirectoryPage(rows, 3);
    const exact = toDirectoryPage(rows.slice(0, 20), 0);
    const empty = toDirectoryPage([], 0);

    expect(full.page).toBe(3);
    expect(full.hasMore).toBe(true);
    expect(full.listings).toHaveLength(20);
    expect(full.listings[0]).toEqual({ listingId: "00000000-0000-4000-8000-000000000001", displayName: "Row 1", line: "Line 1", openToRomance: true, isSample: false, items: [{ kind: "goal", claim: "c", quote: "q" }] });
    expect(full.listings[1]?.openToRomance).toBe(false);
    expect(full.listings[1]?.isSample).toBe(true);
    expect(full.listings[19]?.displayName).toBe("Row 20");
    expect(exact.hasMore).toBe(false);
    expect(exact.listings).toHaveLength(20);
    expect(empty).toEqual({ listings: [], page: 0, hasMore: false });
  });

  it("W6-DAPI-T2 (design section 6, P1, P2): assertCanShare refuses in the order card, approval, positions, listing", () => {
    const refusals = [
      refusalOf(() => { assertCanShare({ card: undefined, shareablePositions: new Set([1]), requestedPositions: [9], isListedCard: true }); }),
      refusalOf(() => { assertCanShare({ card: { state: "ready" }, shareablePositions: new Set([1]), requestedPositions: [9], isListedCard: true }); }),
      refusalOf(() => { assertCanShare({ card: { state: "approved" }, shareablePositions: new Set([1, 2]), requestedPositions: [2, 9], isListedCard: true }); }),
      refusalOf(() => { assertCanShare({ card: { state: "approved" }, shareablePositions: new Set([1]), requestedPositions: [], isListedCard: true }); }),
      refusalOf(() => { assertCanShare({ card: { state: "approved" }, shareablePositions: new Set([1]), requestedPositions: [], isListedCard: false }); }),
      refusalOf(() => { assertCanShare({ card: { state: "approved" }, shareablePositions: new Set([1, 2]), requestedPositions: [1, 2], isListedCard: true }); }),
    ];

    expect(refusals).toEqual([
      { code: "not_found", status: 404, message: "This no longer exists or is not yours." },
      { code: "card_not_approved", status: 409, message: "approve your card before creating a meeting." },
      { code: "payload_invalid", status: 400, message: "Only approved items with a found quote can be public." },
      { code: "listing_needs_public_item", status: 409, message: "To stay in Explore you need at least one public item. Mark one, or leave Explore first." },
      null,
      null,
    ]);
  });

  it("W6-DAPI-T3 (design sections 6 and 11): toListingMeetingError gives each of the five refusals its status and keeps the database's sentence", () => {
    const pairs: [string, number][] = [["listing_not_found", 404], ["directory_self", 409], ["romance_not_open", 409], ["card_not_approved", 409], ["directory_daily_cap", 429]];

    for (const [code, status] of pairs) {
      const refusal = toListingMeetingError({ code, message: "sentence of " + code });

      expect(refusal).toBeInstanceOf(ContractError);
      expect(refusal?.code).toBe(code);
      expect(refusal?.httpStatus).toBe(status);
      expect(refusal?.message).toBe("sentence of " + code);
    }
    expect(toListingMeetingError({ code: "romance_not_open", message: "this person has not opened their persona to dating questions." })?.message).toBe("this person has not opened their persona to dating questions.");
    expect(toListingMeetingError({ code: "pair_not_joined", message: "x" })).toBeNull();
    expect(toListingMeetingError({ code: "duplicate", message: "x" })).toBeNull();
    expect(toListingMeetingError(null)).toBeNull();
  });
});
