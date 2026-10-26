import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS, ScreenFrame } from "../../app-shell/index.js";
import { renderScreen } from "../../testing/index.js";
import { IDS } from "../../testing/fixtures.js";

afterEach(() => {
  cleanup();
});

// Renders a bare screen frame at one page of the app.
function renderFrame(options: { pattern: string; url: string; hideSettingsLink?: boolean }): void {
  renderScreen(
    <ScreenFrame title="A page" hideSettingsLink={options.hideSettingsLink === true}>
      <p>The page body.</p>
    </ScreenFrame>,
    { pattern: options.pattern, url: options.url },
  );
}

describe("screen frame links", () => {
  it("W6-DWEB-T37 (design section 7): a page that needs a session shows Directory, Find help and Friends, then Settings", () => {
    renderFrame({ pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });

    const links = within(screen.getByRole("navigation", { name: "Pages" })).getAllByRole("link");

    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Directory", "/directory"],
      ["Find help", "/help"],
      ["Friends", "/friends"],
      ["Settings", "/settings"],
    ]);
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
      expect(screen.queryByRole("link", { name: "Directory" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Find help" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Friends" })).toBeNull();
      cleanup();
    }
  });

  it("W6-DWEB-T39 (design section 7): the Settings page keeps the three links and drops only its own Settings link", () => {
    renderFrame({ pattern: ROUTE_PATTERNS.settings, url: APP_PATHS.settings, hideSettingsLink: true });

    expect(screen.getByRole("link", { name: "Directory" }).getAttribute("href")).toBe("/directory");
    expect(screen.getByRole("link", { name: "Find help" }).getAttribute("href")).toBe("/help");
    expect(screen.getByRole("link", { name: "Friends" }).getAttribute("href")).toBe("/friends");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
