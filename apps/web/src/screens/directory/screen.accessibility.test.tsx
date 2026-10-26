import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CURATED_QUESTIONS, DirectoryListing, DirectoryPage, ListedMeetingsView, MyListing } from "@meet-first/contracts";
import { clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, SERVER_NOW } from "../../testing/fixtures.js";
import { DirectoryScreen } from "./screen.js";

// The listings of Mira and Ravi, and two meetings the person's persona was in.
const MIRA_LISTING = "00000000-0000-4000-8000-000000000511";
const RAVI_LISTING = "00000000-0000-4000-8000-000000000512";
const ENDED_MEETING = "00000000-0000-4000-8000-000000000521";
const READY_MEETING = "00000000-0000-4000-8000-000000000522";
// GET /api/directory/me for a person with no listing.
const NOT_LISTED: StubInput = { status: 404, body: { code: "not_listed", message: "You are not in the directory." } };
// The directory page with the fixture card in its address, as the card screen's link writes it.
const URL_WITH_CARD = `/directory?card=${IDS.card}`;
// The line shown to a person who is not listed, as listing-parts.tsx writes it.
const NOT_LISTED_LINE = "You are not in the directory. To join, open your approved card and turn on the directory switch.";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// One listing with one public item; isOpen says whether it takes dating questions.
function listing(listingId: string, displayName: string, isOpen: boolean): DirectoryListing {
  return DirectoryListing.parse({
    listingId,
    displayName,
    line: `${displayName} builds small tools`,
    openToRomance: isOpen,
    items: [{ kind: "habit", claim: `${displayName} starts work early`, quote: `I am at my desk by seven, says ${displayName}` }],
  });
}

// One page of the directory.
function page(pageNumber: number, listings: DirectoryListing[], hasMore: boolean): DirectoryPage {
  return DirectoryPage.parse({ listings, page: pageNumber, hasMore });
}

// The person's own listing on the fixture card, with item 1 public.
function myListing(isOpen: boolean): MyListing {
  return MyListing.parse({
    listingId: "00000000-0000-4000-8000-000000000501",
    cardId: IDS.card,
    line: "Builds hackathon tools",
    openToRomance: isOpen,
    items: [{ kind: "value", claim: "Claim number 1", quote: "I said this in my own words, number 1" }],
    createdAt: SERVER_NOW,
  });
}

// Stubs the three reads the page makes when it opens: the listings, the person's listing and the listed meetings.
function stubDirectoryReads(replies: { pages: StubInput[]; listing?: StubInput; meetings?: StubInput }): void {
  stubRoute(routes.directory.browse, replies.pages);
  stubRoute(routes.directory.readMyListing, replies.listing ?? NOT_LISTED);
  stubRoute(routes.directory.listedMeetings, replies.meetings ?? { meetings: [] });
}

// Renders the directory page at one address.
function renderDirectory(url: string): void {
  renderScreen(<DirectoryScreen />, { pattern: ROUTE_PATTERNS.directory, url });
}

// The address values of the nth request to GET /api/directory, counted from 0.
function browseParams(index: number): URLSearchParams {
  const request = requestsTo(routes.directory.browse)[index];
  if (request === undefined) throw new Error(`no directory request ${String(index)}`);
  return new URL(request.url).searchParams;
}

const MIRA = listing(MIRA_LISTING, "Mira", true);
const RAVI = listing(RAVI_LISTING, "Ravi", false);

describe("directory page, against the MSW route stubs (a fake server)", () => {
  it("W6-DWEB-T24 (design sections 7, 10 and 11, P6): each listing shows its name, line, public items with quotes, and the dating words only when open, and no id or number", async () => {
    stubDirectoryReads({ pages: [page(0, [MIRA, RAVI], false)] });

    renderDirectory(URL_WITH_CARD);
    const mira = (await screen.findByRole("heading", { name: "Mira" })).closest("li");
    const ravi = screen.getByRole("heading", { name: "Ravi" }).closest("li");
    if (mira === null || ravi === null) throw new Error("a listing is not inside a list item");

    expect(within(mira).getByText("Mira builds small tools")).toBeTruthy();
    expect(within(mira).getByText("Mira starts work early")).toBeTruthy();
    expect(within(mira).getByText("I am at my desk by seven, says Mira")).toBeTruthy();
    expect(within(mira).getByText("Open to dating questions")).toBeTruthy();
    expect(within(ravi).queryByText("Open to dating questions")).toBeNull();
    expect(mira.textContent).not.toMatch(/[0-9]/);
    expect(document.body.textContent).not.toContain(MIRA_LISTING);
    expect(document.body.textContent).not.toContain(RAVI_LISTING);
  });

  it("W6-DWEB-T25 (design section 7): More loads the next page of the same search below the first, then goes away", async () => {
    stubDirectoryReads({ pages: [page(0, [MIRA], true), page(1, [RAVI], false)] });
    renderDirectory(URL_WITH_CARD);
    await screen.findByRole("heading", { name: "Mira" });

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(await screen.findByRole("heading", { name: "Ravi" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(browseParams(1).get("page")).toBe("1");
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("W6-DWEB-T26 (design section 6): a search sends the trimmed words from page 0 and replaces the listings; the first load sends no words", async () => {
    stubDirectoryReads({ pages: [page(0, [MIRA, RAVI], false), page(0, [RAVI], false)] });
    renderDirectory(URL_WITH_CARD);
    await screen.findByRole("heading", { name: "Mira" });

    fireEvent.change(screen.getByRole("textbox", { name: "Search the directory" }), { target: { value: "  starts early  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Mira" })).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "Ravi" })).toBeTruthy();
    expect([browseParams(0).get("query"), browseParams(0).get("page")]).toEqual([null, "0"]);
    expect([browseParams(1).get("query"), browseParams(1).get("page")]).toEqual(["starts early", "0"]);
  });

  it("W6-DWEB-T27 (design section 7): an empty directory and a search that finds nobody each say so", async () => {
    stubDirectoryReads({ pages: [page(0, [], false), page(0, [], false)] });
    renderDirectory(URL_WITH_CARD);

    expect(await screen.findByText("Nobody is listed yet.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search the directory" }), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No listing matches these words.")).toBeTruthy();
    expect(screen.queryByText("Nobody is listed yet.")).toBeNull();
  });

  it("W6-DWEB-T28 (design section 11): Meet opens the picker without the couple group for a listing closed to dating questions, and with it for an open one", async () => {
    stubDirectoryReads({ pages: [page(0, [MIRA, RAVI], false)] });
    renderDirectory(URL_WITH_CARD);

    fireEvent.click(await screen.findByRole("button", { name: "Meet Ravi" }));
    const closedPicker = screen.getByRole("group", { name: "Pick a question for the meeting" });
    expect(screen.queryByRole("group", { name: "Would you get on as a couple?" })).toBeNull();
    expect(closedPicker.querySelectorAll('input[type="radio"]')).toHaveLength(17);

    fireEvent.click(screen.getByRole("button", { name: "Meet Mira" }));

    const openPicker = screen.getByRole("group", { name: "Pick a question for the meeting" });
    expect(screen.getByRole("group", { name: "Would you get on as a couple?" }).querySelectorAll('input[type="radio"]')).toHaveLength(4);
    expect(openPicker.querySelectorAll('input[type="radio"]')).toHaveLength(21);
  });

  it("W6-DWEB-T29 (design section 7): creating a meeting from a listing sends the question and this card, then opens the meeting page", async () => {
    const debate = CURATED_QUESTIONS.find((question) => question.id === 13);
    if (debate === undefined) throw new Error("curated question 13 is missing");
    stubDirectoryReads({ pages: [page(0, [MIRA], false)] });
    stubRoute(routes.directory.createListingMeeting, { status: 201, body: { meetingId: IDS.meeting } });
    renderDirectory(URL_WITH_CARD);

    fireEvent.click(await screen.findByRole("button", { name: "Meet Mira" }));
    fireEvent.click(screen.getByRole("radio", { name: debate.text }));
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));

    expect((await screen.findByTestId("location")).textContent).toBe(`/meetings/${IDS.meeting}`);
    expect(requestsTo(routes.directory.createListingMeeting)).toHaveLength(1);
    expect(requestsTo(routes.directory.createListingMeeting)[0]?.url).toContain(`/api/directory/${MIRA_LISTING}/meetings`);
    expect(requestsTo(routes.directory.createListingMeeting)[0]?.body).toEqual({ questionId: 13, cardId: IDS.card });
  });

  it("W6-DWEB-T30 (design section 5): a refused meeting shows the server's sentence under the picker and the page stays", async () => {
    const sentence = "this persona has met as many people as it can today. Try again tomorrow.";
    stubDirectoryReads({ pages: [page(0, [MIRA], false)] });
    stubRoute(routes.directory.createListingMeeting, { status: 429, body: { code: "directory_daily_cap", message: sentence } });
    renderDirectory(URL_WITH_CARD);

    fireEvent.click(await screen.findByRole("button", { name: "Meet Mira" }));
    fireEvent.click(screen.getByRole("radio", { name: "Would we enjoy a 10-day hackathon together?" }));
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));

    expect((await screen.findByRole("alert")).textContent).toBe(sentence);
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByRole("group", { name: "Pick a question for the meeting" })).toBeTruthy();
  });

  it("W6-DWEB-T31 (design section 7): free text outside 5 to 300 characters is refused before any request", async () => {
    stubDirectoryReads({ pages: [page(0, [MIRA], false)] });
    stubRoute(routes.directory.createListingMeeting, { status: 201, body: { meetingId: IDS.meeting } });
    renderDirectory(URL_WITH_CARD);

    fireEvent.click(await screen.findByRole("button", { name: "Meet Mira" }));
    fireEvent.click(screen.getByRole("radio", { name: "Write your own question" }));
    fireEvent.change(screen.getByLabelText("Your question (5 to 300 characters)"), { target: { value: "Hm?" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));

    expect(await screen.findByText("Write a question of 5 to 300 characters.")).toBeTruthy();
    expect(requestsTo(routes.directory.createListingMeeting)).toHaveLength(0);
  });

  it("W6-DWEB-T32 (design section 7): with no card known the listings show no Meet button and say how to get one", async () => {
    stubDirectoryReads({ pages: [page(0, [MIRA], false)] });

    renderDirectory("/directory");
    await screen.findByText(NOT_LISTED_LINE);
    await screen.findByRole("heading", { name: "Mira" });

    expect(screen.getByText("To meet someone here, open your approved card and tap Open the directory.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Meet Mira" })).toBeNull();
  });

  it("W6-DWEB-T33 (P2, P8): Your listing shows the line, the dating words and the items, and Leave sends one DELETE and says so", async () => {
    stubDirectoryReads({ pages: [page(0, [], false)], listing: myListing(true) });
    stubRoute(routes.directory.leave, { status: 204, body: null });
    renderDirectory("/directory");
    const section = (await screen.findByRole("heading", { name: "Your listing" })).closest("section");
    if (section === null) throw new Error("Your listing is not inside a section");
    expect(await within(section).findByText("Builds hackathon tools")).toBeTruthy();
    expect(within(section).getByText("Open to dating questions")).toBeTruthy();
    expect(within(section).getByText("Claim number 1")).toBeTruthy();

    fireEvent.click(within(section).getByRole("button", { name: "Leave the directory" }));

    expect(await within(section).findByText("You left the directory. Meetings already made stay below.")).toBeTruthy();
    expect(requestsTo(routes.directory.leave)).toHaveLength(1);
    expect(within(section).queryByRole("button", { name: "Leave the directory" })).toBeNull();
    expect(within(section).getByText(NOT_LISTED_LINE)).toBeTruthy();
  });

  it("W6-DWEB-T34 (P2): a person who is not listed sees how to join and no Leave button", async () => {
    stubDirectoryReads({ pages: [page(0, [], false)] });

    renderDirectory(URL_WITH_CARD);

    expect(await screen.findByText(NOT_LISTED_LINE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave the directory" })).toBeNull();
  });

  it("W6-DWEB-T35 (P4): the meetings your persona was in link to their meeting, and to their brief once ended", async () => {
    const debate = CURATED_QUESTIONS.find((question) => question.id === 13)?.text ?? "";
    const meetings = ListedMeetingsView.parse({
      meetings: [
        { meetingId: ENDED_MEETING, otherDisplayName: "Ravi", questionText: debate, state: "ended", createdAt: SERVER_NOW },
        { meetingId: READY_MEETING, otherDisplayName: "Mira", questionText: "Should we split work by strengths?", state: "ready", createdAt: SERVER_NOW },
      ],
    });
    stubDirectoryReads({ pages: [page(0, [], false)], listing: myListing(false), meetings });

    renderDirectory("/directory");

    expect(await screen.findByText(`Ravi: ${debate}`)).toBeTruthy();
    expect(screen.getByText("Mira: Should we split work by strengths?")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open the meeting" }).map((link) => link.getAttribute("href"))).toEqual([`/meetings/${ENDED_MEETING}`, `/meetings/${READY_MEETING}`]);
    expect(screen.getAllByRole("link", { name: "Read the brief" }).map((link) => link.getAttribute("href"))).toEqual([`/meetings/${ENDED_MEETING}/brief`]);
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  it("W6-DWEB-T36 (design section 7): every control on the directory page has an accessible name at 375 px, with a picker open", async () => {
    stubDirectoryReads({ pages: [page(0, [MIRA, RAVI], true)], listing: myListing(true) });
    renderDirectory(URL_WITH_CARD);

    fireEvent.click(await screen.findByRole("button", { name: "Meet Mira" }));
    await screen.findByText("Builds hackathon tools");

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
