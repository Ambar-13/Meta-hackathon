import { describe, expect, it } from "vitest";
import { DirectoryListing, DirectoryPage } from "@meet-first/contracts";
import { cardForMeeting, directoryQueryFor, leaveOutKindsFor, withPage, type BrowseState } from "./directory-state.js";

// Three cards: one in the address, one approved in this tab, one the person's listing is on.
const ADDRESS_CARD = "00000000-0000-4000-8000-000000000111";
const APPROVED_CARD = "00000000-0000-4000-8000-000000000112";
const LISTED_CARD = "00000000-0000-4000-8000-000000000113";

// One listing whose id ends in the given digit; isOpen says whether it takes dating questions.
function listing(digit: number, isOpen: boolean): DirectoryListing {
  return DirectoryListing.parse({ listingId: `00000000-0000-4000-8000-00000000051${String(digit)}`, displayName: `Person ${String(digit)}`, line: "A line", openToRomance: isOpen, items: [] });
}

// The browse state after one page that held the given listings, with a request out.
function stateWith(listings: DirectoryListing[]): BrowseState {
  return { query: "", listings, nextPage: 1, hasMore: true, hasLoaded: true, isLoading: true, error: null };
}

describe("directory page state", () => {
  it("W6-DWEB-T20 (design section 6): directoryQueryFor sends the page always and the words only when the trimmed search is not empty", () => {
    const none = directoryQueryFor("", 0);
    const blank = directoryQueryFor("   ", 2);
    const words = directoryQueryFor("  starts early ", 1);

    expect(none).toEqual({ page: 0 });
    expect(blank).toEqual({ page: 2 });
    expect(words).toEqual({ query: "starts early", page: 1 });
  });

  it("W6-DWEB-T21 (design section 7): withPage replaces the listings for page 0 and adds a later page after them", () => {
    const first = listing(1, false);
    const second = listing(2, true);

    const replaced = withPage(stateWith([first]), DirectoryPage.parse({ listings: [second], page: 0, hasMore: false }));
    const added = withPage(stateWith([first]), DirectoryPage.parse({ listings: [second], page: 1, hasMore: true }));

    expect(replaced.listings).toEqual([second]);
    expect([replaced.nextPage, replaced.hasMore, replaced.hasLoaded, replaced.isLoading]).toEqual([1, false, true, false]);
    expect(added.listings).toEqual([first, second]);
    expect([added.nextPage, added.hasMore]).toEqual([2, true]);
  });

  it("W6-DWEB-T22 (design section 7): cardForMeeting takes the card in the address, then this tab's approved card, then the listed card, else none", () => {
    const fromAddress = cardForMeeting({ search: `?card=${ADDRESS_CARD}`, approvedCardId: APPROVED_CARD, listedCardId: LISTED_CARD });
    const fromTab = cardForMeeting({ search: "", approvedCardId: APPROVED_CARD, listedCardId: LISTED_CARD });
    const fromListing = cardForMeeting({ search: "", approvedCardId: null, listedCardId: LISTED_CARD });
    const none = cardForMeeting({ search: "?card=nope", approvedCardId: null, listedCardId: null });

    expect([fromAddress, fromTab, fromListing, none]).toEqual([ADDRESS_CARD, APPROVED_CARD, LISTED_CARD, null]);
  });

  it("W6-DWEB-T23 (design section 11): leaveOutKindsFor leaves out romance only for a listing closed to dating questions", () => {
    const open = leaveOutKindsFor(listing(1, true));
    const closed = leaveOutKindsFor(listing(2, false));

    expect(open).toEqual([]);
    expect(closed).toEqual(["romance"]);
  });
});
