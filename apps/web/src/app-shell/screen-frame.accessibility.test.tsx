import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { FriendRequestsView, FriendsView, type Friend } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes, ScreenFrame } from "./index.js";
import { renderScreen, stubRoute } from "../testing/index.js";
import { IDS, SERVER_NOW } from "../testing/fixtures.js";

afterEach(() => {
  cleanup();
});

// The fixed ids of this file.
const ID = (n: number): string => `00000000-0000-4000-8000-${String(700 + n).padStart(12, "0")}`;
// Two friends: Bea is in Explore, Cal is not.
const BEA: Friend = { pairId: ID(1), displayName: "Bea", canAsk: true, listingId: ID(11) };
const CAL: Friend = { pairId: ID(2), displayName: "Cal", canAsk: false, listingId: null };

// Renders a bare screen frame at one page of the app.
function renderFrame(options: { pattern: string; url: string; hideSettingsLink?: boolean; width?: 375 | 1024 }): void {
  renderScreen(
    <ScreenFrame title="A page" hideSettingsLink={options.hideSettingsLink === true}>
      <p>The page body.</p>
    </ScreenFrame>,
    { pattern: options.pattern, url: options.url, width: options.width ?? 375 },
  );
}

// One incoming request from a person with this name.
function incoming(n: number, name: string): FriendRequestsView["incoming"][number] {
  return { requestId: ID(20 + n), direction: "incoming", otherName: name, otherListingId: null, createdAt: SERVER_NOW };
}

// The links of the Pages nav as [words, href, aria-current].
function pageLinks(): Array<[string | null, string | null, string | null]> {
  const links = within(screen.getByRole("navigation", { name: "Pages" })).getAllByRole("link");
  return links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")]);
}

describe("screen frame links", () => {
  it("W6-DWEB-T37, updated for wave 7: a page that needs a session shows Chat, Explore, Friends and Me, then Settings, and no Directory or Find help", () => {
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });

    expect(pageLinks().map(([words, href]) => [words, href])).toEqual([
      ["Chat", "/home"],
      ["Explore", "/explore"],
      ["Friends", "/friends"],
      ["Me", "/me"],
      ["Settings", "/settings"],
    ]);
    expect(screen.queryByRole("link", { name: "Directory" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Find help" })).toBeNull();
  });

  it("W6-DWEB-T38 (design section 7): the start, claim, join and share pages show no link into the app", () => {
    const pages = [
      { pattern: ROUTE_PATTERNS.welcome, url: APP_PATHS.welcome },
      { pattern: ROUTE_PATTERNS.claim, url: APP_PATHS.claim },
      { pattern: ROUTE_PATTERNS.join, url: APP_PATHS.join },
      { pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage("slug1234") },
    ];

    for (const page of pages) {
      renderFrame(page);
      for (const name of ["Chat", "Explore", "Friends", "Me", "Directory", "Find help"]) {
        expect(screen.queryByRole("link", { name })).toBeNull();
      }
      cleanup();
    }
  });

  it("W6-DWEB-T39, updated for wave 7: the Settings page keeps the four page links and drops only its own Settings links", () => {
    renderFrame({ pattern: ROUTE_PATTERNS.settings, url: APP_PATHS.settings, hideSettingsLink: true });

    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("href")).toBe("/explore");
    expect(screen.getByRole("link", { name: "Friends" }).getAttribute("href")).toBe("/friends");
    expect(screen.getByRole("link", { name: "Me" }).getAttribute("href")).toBe("/me");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("W7-WEB-A-T1: the Pages nav lists Chat, Explore, Friends, Me and Settings in order with aria-current on the current page, and the Friends nav lists each friend, linking to their profile when listed", async () => {
    stubRoute(routes.directory.friends, FriendsView.parse({ friends: [BEA, CAL] }));
    renderFrame({ pattern: ROUTE_PATTERNS.explore, url: APP_PATHS.explore, width: 1024 });

    expect(pageLinks()).toEqual([
      ["Chat", "/home", null],
      ["Explore", "/explore", "page"],
      ["Friends", "/friends", null],
      ["Me", "/me", null],
      ["Settings", "/settings", null],
    ]);
    const friendsNav = await screen.findByRole("navigation", { name: "Friends" });
    const friendLinks = within(friendsNav).getAllByRole("link");
    expect(friendLinks.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["BBea", `/people/${ID(11)}`],
      ["CCal", "/friends"],
    ]);
    expect(screen.getByRole("link", { name: "Bea" }).getAttribute("href")).toBe(`/people/${ID(11)}`);
  });

  it("W7-WEB-A-T1b: the Friends nav says so when there are no friends and offers Explore, and offers See all friends past 12", async () => {
    renderFrame({ pattern: ROUTE_PATTERNS.friends, url: APP_PATHS.friends, width: 1024 });
    const empty = await screen.findByRole("navigation", { name: "Friends" });
    expect(within(empty).getByText("No friends yet.")).toBeTruthy();
    expect(within(empty).getByRole("link", { name: "Find people in Explore" }).getAttribute("href")).toBe("/explore");
    expect(within(screen.getByRole("navigation", { name: "Pages" })).getByRole("link", { name: "Friends" }).getAttribute("aria-current")).toBe("page");
    cleanup();

    const many = Array.from({ length: 14 }, (unused, index): Friend => ({ pairId: ID(30 + index), displayName: `Friend ${String(index + 1)}`, canAsk: true, listingId: null }));
    stubRoute(routes.directory.friends, FriendsView.parse({ friends: many }));
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card), width: 1024 });
    const nav = await screen.findByRole("navigation", { name: "Friends" });
    await within(nav).findByText("Friend 1");
    expect(within(nav).getAllByRole("listitem")).toHaveLength(12);
    expect(within(nav).getByRole("link", { name: "See all friends" }).getAttribute("href")).toBe("/friends");
  });

  it("W7-WEB-A-T2: with 2 incoming requests the Friends link's accessible name is Friends, 2 requests", async () => {
    stubRoute(routes.social.listFriendRequests, FriendRequestsView.parse({ incoming: [incoming(1, "Ola"), incoming(2, "Pim")], outgoing: [] }));
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });

    const link = await screen.findByRole("link", { name: "Friends, 2 requests" });
    expect(link.getAttribute("href")).toBe("/friends");
    expect(link.textContent).toBe("Friends2");
  });

  it("W7-WEB-A-T2b: a failed rail read shows the pages and no friend list or error", async () => {
    stubRoute(routes.directory.friends, { status: 500, body: { code: "server_error", message: "Something went wrong on our side." } });
    stubRoute(routes.social.listFriendRequests, { status: 500, body: { code: "server_error", message: "Something went wrong on our side." } });
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card), width: 1024 });

    expect(await screen.findByText("The page body.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pageLinks()).toHaveLength(5);
    expect(screen.queryByRole("navigation", { name: "Friends" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("W7-WEB-A-T3: pages without a session keep today's frame: the logo to the start page, Settings as the one Pages link, and no Friends nav", async () => {
    renderFrame({ pattern: ROUTE_PATTERNS.welcome, url: APP_PATHS.welcome, width: 1024 });

    expect(pageLinks()).toEqual([["Settings", "/settings", null]]);
    expect(screen.getByRole("link", { name: "Meet First" }).getAttribute("href")).toBe("/");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("navigation", { name: "Friends" })).toBeNull();
    expect(document.querySelector(".social-rail")).toBeNull();
  });
});
