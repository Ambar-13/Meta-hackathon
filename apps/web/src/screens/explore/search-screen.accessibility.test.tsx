import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  DirectoryListing,
  DirectoryPage,
  type FriendsView,
  type PostsView,
} from "@meet-first/contracts";
import {
  APP_PATHS,
  chatPathWithDraft,
  clearClientState,
  personPostsPath,
  ROUTE_PATTERNS,
  routes,
} from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { LISTING_IDS } from "../../testing/fixtures.js";
import { SearchScreen } from "./search-screen.js";

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
    isSample: false,
    items: [
      {
        kind: "habit",
        claim: `${displayName} starts work early`,
        quote: `I am at my desk by seven, says ${displayName}`,
      },
    ],
  });
}

// One page of Explore.
function page(pageNumber: number, listings: DirectoryListing[], hasMore: boolean): DirectoryPage {
  return DirectoryPage.parse({ listings, page: pageNumber, hasMore });
}

// A post by Ravi with a photo, n making its id, and these words for the photo.
function photoPost(n: number, photo: string, photoAlt: string): PostsView["posts"][number] {
  return {
    postId: `00000000-0000-4000-8000-00000000080${String(n)}`,
    listingId: LISTING_IDS.ravi,
    displayName: "Ravi",
    isSample: true,
    text: `Photo ${String(n)}.`,
    createdAt: new Date(Date.now() - n * 3_600_000).toISOString(),
    photo,
    photoAlt,
  };
}

// What Search's other two reads answer in a test: the replies for GET /api/posts, and the friends
// list.
type OtherReads = { posts?: StubInput[]; friends?: FriendsView };

// Renders Search with these replies for GET /api/directory; no posts and no friends unless given.
function renderSearch(pages: StubInput[], others: OtherReads = {}): void {
  stubRoute(routes.social.listPosts, others.posts ?? [{ posts: [] }]);
  stubRoute(routes.directory.friends, others.friends ?? { friends: [] });
  stubRoute(routes.directory.browse, pages);
  renderScreen(<SearchScreen />, { pattern: ROUTE_PATTERNS.search, url: APP_PATHS.search });
}

// The address values of the nth request to GET /api/directory, counted from 0.
function browseParams(index: number): URLSearchParams {
  const request = requestsTo(routes.directory.browse)[index];
  if (request === undefined) throw new Error(`no directory request ${String(index)}`);
  return new URL(request.url).searchParams;
}

// The link of the person with this name: the link that holds their name heading in a row.
async function personLinkOf(name: string): Promise<HTMLElement> {
  const link = (await screen.findByRole("heading", { name })).closest("a");
  if (link === null) throw new Error(`the name of ${name} is not in a link`);
  return link;
}

// Types these words into the search box and presses Search.
function searchFor(words: string): void {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), {
    target: { value: words },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

const MIRA = listing(LISTING_IDS.mira, "Mira", true);
const RAVI = listing(LISTING_IDS.ravi, "Ravi", false);

describe("Search, against the MSW route stubs (a fake server)", () => {
  it("W7-SEARCH-T1: each person is a row linking to their profile with their line, first claim and dating words, never an id or a number, and Add friend sends a friend request", async () => {
    stubRoute(routes.social.sendFriendRequest, {
      status: 201,
      body: { requestId: LISTING_IDS.request },
    });
    renderSearch([page(0, [MIRA, RAVI], false)]);
    const mira = await personLinkOf("Mira");

    expect(mira.getAttribute("href")).toBe(`/people/${LISTING_IDS.mira}`);
    expect(within(mira).getByText("Mira builds small tools")).toBeTruthy();
    expect(within(mira).getByText("Mira starts work early")).toBeTruthy();
    expect(within(mira).getByText("Open to dating questions")).toBeTruthy();
    expect(within(await personLinkOf("Ravi")).queryByText("Open to dating questions")).toBeNull();
    expect(mira.textContent).not.toMatch(/[0-9]/);
    expect(document.body.textContent).not.toContain(LISTING_IDS.mira);
    fireEvent.click(screen.getByRole("button", { name: "Add Ravi as a friend" }));

    expect(await screen.findByText("Requested")).toBeTruthy();
    expect(requestsTo(routes.social.sendFriendRequest)[0]?.body).toEqual({
      listingId: LISTING_IDS.ravi,
    });
  });

  it("W7-SEARCH-T2: a search sends the trimmed words from page 0 and shows People; nobody found shows the empty state; the first load sends no words", async () => {
    renderSearch([page(0, [MIRA, RAVI], false), page(0, [RAVI], false), page(0, [], false)]);
    await personLinkOf("Mira");
    searchFor("  rav  ");

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Mira" })).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "People" })).toBeTruthy();
    expect([browseParams(0).get("query"), browseParams(0).get("page")]).toEqual([null, "0"]);
    expect([browseParams(1).get("query"), browseParams(1).get("page")]).toEqual(["rav", "0"]);
    searchFor("underwater robots");

    expect(await screen.findByRole("heading", { name: "Nobody matches yet" })).toBeTruthy();
    expect(screen.getByText("Try a name, or what someone does.")).toBeTruthy();
  });

  it("W7-SEARCH-T3: with no search it suggests six people, See everyone shows the rest, and Show more loads the next page", async () => {
    const many = ["Ana", "Bea", "Cal", "Dee", "Eli", "Fay", "Gus"].map((name, index) =>
      listing(`00000000-0000-4000-8000-00000000090${String(index)}`, name, false),
    );
    renderSearch([page(0, many, true), page(1, [RAVI], false)]);
    await screen.findByRole("heading", { name: "Suggested for you" });

    expect(screen.queryByRole("heading", { name: "Gus" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See everyone" }));
    expect(await screen.findByRole("heading", { name: "Gus" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Everyone" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("heading", { name: "Ravi" })).toBeTruthy();
    expect(browseParams(1).get("page")).toBe("1");
  });

  it("W7-SEARCH-T4: the photos sit under Explore as Instagram's grid, each a link to its writer's Posts tab named with the words for the photo; with no photos there is no Explore", async () => {
    renderSearch([page(0, [MIRA, RAVI], false)], {
      posts: [
        {
          posts: [
            photoPost(1, "ravi-whiteboard", "A whiteboard."),
            photoPost(2, "jun-robot", "A robot."),
          ],
        },
      ],
    });
    const photos = await screen.findByRole("region", { name: "Explore" });
    const tiles = within(photos).getAllByRole("link");

    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
      "Ravi's posts: A whiteboard.",
      "Ravi's posts: A robot.",
    ]);
    expect(tiles.map((tile) => tile.getAttribute("href"))).toEqual([
      personPostsPath(LISTING_IDS.ravi),
      personPostsPath(LISTING_IDS.ravi),
    ]);
    expect(tiles[1]?.querySelector("img")?.getAttribute("src")).toContain("jun-robot");
    cleanup();
    renderSearch([page(0, [MIRA], false)]);

    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Explore" })).toBeNull();
  });

  it("W7-SEARCH-T5: a failed load shows the server's sentence and Try again loads again; the help line opens Meety with a question started", async () => {
    renderSearch([
      { status: 500, body: { code: "server_error", message: "Something went wrong on our side." } },
      page(0, [MIRA], false),
    ]);

    expect(await screen.findByText("Something went wrong on our side.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Ask Meety who could help." }).getAttribute("href"),
    ).toBe(chatPathWithDraft("Who could help me with "));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
  });

  it("W7-SEARCH-T6: every control on Search has an accessible name at 375 px", async () => {
    renderSearch([page(0, [MIRA, RAVI], true)], {
      posts: [{ posts: [photoPost(1, "ravi-whiteboard", "A whiteboard.")] }],
    });
    await personLinkOf("Mira");
    await screen.findByRole("region", { name: "Explore" });

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
