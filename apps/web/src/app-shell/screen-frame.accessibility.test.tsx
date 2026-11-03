import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { FriendRequestsView } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes, ScreenFrame } from "./index.js";
import { renderScreen, stubRoute } from "../testing/index.js";
import { IDS, SERVER_NOW } from "../testing/fixtures.js";

afterEach(() => {
  cleanup();
});

// The fixed ids of this file.
const ID = (n: number): string => `00000000-0000-4000-8000-${String(700 + n).padStart(12, "0")}`;

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
  it("W6-DWEB-T37, updated for 3 Nov: a page that needs a session shows Home, Search, Meety, Friends and Me, as Instagram orders its tabs, then Invite a friend (the laptop sidebar's) and Settings, and no Directory or Find help", () => {
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });

    expect(pageLinks().map(([words, href]) => [words, href])).toEqual([
      ["Home", "/home"],
      ["Search", "/search"],
      ["Meety", "/meety"],
      ["Friends", "/friends"],
      ["Me", "/me"],
      ["Invite a friend", "/pair"],
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
      for (const name of ["Home", "Search", "Meety", "Explore", "Friends", "Me", "Directory", "Find help"]) {
        expect(screen.queryByRole("link", { name })).toBeNull();
      }
      cleanup();
    }
  });

  it("W6-DWEB-T39, updated for wave 7: the Settings page keeps the four page links and drops only its own Settings links", () => {
    renderFrame({ pattern: ROUTE_PATTERNS.settings, url: APP_PATHS.settings, hideSettingsLink: true });

    expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe("/search");
    expect(screen.getByRole("link", { name: "Friends" }).getAttribute("href")).toBe("/friends");
    expect(screen.getByRole("link", { name: "Me" }).getAttribute("href")).toBe("/me");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("W7-WEB-A-T1, updated for 3 Nov: the Pages nav lists Home, Search, Meety, Friends, Me and Settings in order with aria-current on the current page, and the frame lists no friends, which the chat's right-hand column does", () => {
    renderFrame({ pattern: ROUTE_PATTERNS.search, url: APP_PATHS.search, width: 1024 });

    expect(pageLinks()).toEqual([
      ["Home", "/home", null],
      ["Search", "/search", "page"],
      ["Meety", "/meety", null],
      ["Friends", "/friends", null],
      ["Me", "/me", null],
      ["Invite a friend", "/pair", null],
      ["Settings", "/settings", null],
    ]);
    expect(screen.queryByRole("navigation", { name: "Friends" })).toBeNull();
  });

  it("W7-WEB-A-T2: with 2 incoming requests the Friends link's accessible name is Friends, 2 requests", async () => {
    stubRoute(routes.social.listFriendRequests, FriendRequestsView.parse({ incoming: [incoming(1, "Ola"), incoming(2, "Pim")], outgoing: [] }));
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });

    const link = await screen.findByRole("link", { name: "Friends, 2 requests" });
    expect(link.getAttribute("href")).toBe("/friends");
    expect(link.textContent).toBe("2Friends");
  });

  it("W7-WEB-A-T2b: a failed rail read shows the pages and no friend list or error", async () => {
    stubRoute(routes.directory.friends, { status: 500, body: { code: "server_error", message: "Something went wrong on our side." } });
    stubRoute(routes.social.listFriendRequests, { status: 500, body: { code: "server_error", message: "Something went wrong on our side." } });
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card), width: 1024 });

    expect(await screen.findByText("The page body.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pageLinks()).toHaveLength(7);
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
