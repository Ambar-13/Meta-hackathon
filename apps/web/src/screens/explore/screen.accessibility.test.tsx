import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DirectoryListing, DirectoryPage } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { LISTING_IDS } from "../../testing/fixtures.js";
import { ExploreScreen } from "./screen.js";

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

// One page of Explore.
function page(pageNumber: number, listings: DirectoryListing[], hasMore: boolean): DirectoryPage {
  return DirectoryPage.parse({ listings, page: pageNumber, hasMore });
}

// Renders Explore with these replies for GET /api/directory.
function renderExplore(pages: StubInput[]): void {
  stubRoute(routes.directory.browse, pages);
  renderScreen(<ExploreScreen />, { pattern: ROUTE_PATTERNS.explore, url: APP_PATHS.explore });
}

// The address values of the nth request to GET /api/directory, counted from 0.
function browseParams(index: number): URLSearchParams {
  const request = requestsTo(routes.directory.browse)[index];
  if (request === undefined) throw new Error(`no directory request ${String(index)}`);
  return new URL(request.url).searchParams;
}

// The tile of the person with this name: the link that holds their name heading.
async function tileOf(name: string): Promise<HTMLElement> {
  const tile = (await screen.findByRole("heading", { name })).closest("a");
  if (tile === null) throw new Error(`the tile of ${name} is not a link`);
  return tile;
}

const MIRA = listing(LISTING_IDS.mira, "Mira", true);
const RAVI = listing(LISTING_IDS.ravi, "Ravi", false);

describe("Explore page, against the MSW route stubs (a fake server)", () => {
  it("W7-WEB-A-T4: each tile is one link to /people/:listingId, a search sends the query, and the empty state shows its title", async () => {
    renderExplore([page(0, [MIRA, RAVI], false), page(0, [], false)]);

    expect((await tileOf("Mira")).getAttribute("href")).toBe(`/people/${LISTING_IDS.mira}`);
    expect((await tileOf("Ravi")).getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}`);

    fireEvent.change(screen.getByRole("textbox", { name: "Search Explore" }), { target: { value: "robots" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("heading", { name: "Nobody matches yet" })).toBeTruthy();
    expect(screen.getByText("Try other words, or clear the search.")).toBeTruthy();
    expect(browseParams(1).get("query")).toBe("robots");
  });

  it("W6-DWEB-T24, moved to Explore: each tile shows the name, the line, the first public item's claim, and the dating words only when open, and no id or number", async () => {
    renderExplore([page(0, [MIRA, RAVI], false)]);
    const mira = await tileOf("Mira");
    const ravi = await tileOf("Ravi");

    expect(within(mira).getByText("Mira builds small tools")).toBeTruthy();
    expect(within(mira).getByText("Mira starts work early")).toBeTruthy();
    expect(within(mira).getByText("Open to dating questions")).toBeTruthy();
    expect(within(ravi).queryByText("Open to dating questions")).toBeNull();
    expect(mira.textContent).not.toMatch(/[0-9]/);
    expect(document.body.textContent).not.toContain(LISTING_IDS.mira);
    expect(document.body.textContent).not.toContain(LISTING_IDS.ravi);
  });

  it("W6-DWEB-T25, moved to Explore: Show more loads the next page of the same search below the first, then goes away", async () => {
    renderExplore([page(0, [MIRA], true), page(1, [RAVI], false)]);
    await tileOf("Mira");

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("heading", { name: "Ravi" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(browseParams(1).get("page")).toBe("1");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("W6-DWEB-T26, moved to Explore: a search sends the trimmed words from page 0 and replaces the tiles; the first load sends no words", async () => {
    renderExplore([page(0, [MIRA, RAVI], false), page(0, [RAVI], false)]);
    await tileOf("Mira");

    fireEvent.change(screen.getByRole("textbox", { name: "Search Explore" }), { target: { value: "  starts early  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Mira" })).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "Ravi" })).toBeTruthy();
    expect([browseParams(0).get("query"), browseParams(0).get("page")]).toEqual([null, "0"]);
    expect([browseParams(1).get("query"), browseParams(1).get("page")]).toEqual(["starts early", "0"]);
  });

  it("W6-DWEB-T27, moved to Explore: an empty Explore and a search that finds nobody each show the empty state", async () => {
    renderExplore([page(0, [], false), page(0, [], false)]);

    expect(await screen.findByRole("heading", { name: "Nobody matches yet" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Explore" }), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(requestsTo(routes.directory.browse)).toHaveLength(2);
    });
    expect(await screen.findByRole("heading", { name: "Nobody matches yet" })).toBeTruthy();
  });

  it("W7-WEB-A-T4b: a failed load shows the server's sentence and Try again loads again; the help line links to the chat", async () => {
    renderExplore([{ status: 500, body: { code: "server_error", message: "Something went wrong on our side." } }, page(0, [MIRA], false)]);

    expect(await screen.findByText("Something went wrong on our side.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask Meety who could help." }).getAttribute("href")).toBe("/home");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(screen.queryByText("Something went wrong on our side.")).toBeNull();
  });

  it("W6-DWEB-T36, moved to Explore: every control on Explore has an accessible name at 375 px", async () => {
    renderExplore([page(0, [MIRA, RAVI], true)]);
    await tileOf("Mira");

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
