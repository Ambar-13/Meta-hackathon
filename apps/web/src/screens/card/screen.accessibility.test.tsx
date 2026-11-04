import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { APP_PATHS, readApprovedCard, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { cardView, IDS, itemId } from "../../testing/fixtures.js";
import { RECALL_SWITCH_COPY } from "@meet-first/contracts";
import { CardScreen } from "./screen.js";

// An approved card shows the Sharing section, which reads the card's sharing settings and the person's listing; these two answers
// keep the card tests below as they were: nothing shared, not listed.
beforeEach(() => {
  stubRoute(routes.directory.readSharing, { friendsCanAsk: false, publicPositions: [] });
  stubRoute(routes.directory.readMyListing, {
    status: 404,
    body: { code: "not_listed", message: "You are not in Explore yet." },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Renders the card page for the fixture card.
function renderCard(): void {
  renderScreen(<CardScreen />, { pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });
}

describe("card screen", () => {
  it("R3.4-T2: while building the screen polls every 3 s and counts seconds on the server clock, using fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.cards.readCard, [
      cardView("building", "2026-10-27T10:00:00.000Z"),
      cardView("building", "2026-10-27T10:00:03.000Z"),
      cardView("ready", "2026-10-27T10:00:06.000Z"),
    ]);
    renderCard();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Building your card. 0 s so far.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("Building your card. 3 s so far.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("Claim number 1")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(requestsTo(routes.cards.readCard)).toHaveLength(3);
  });

  it("R7.1-T2: the recall switch shows its copy verbatim and starts off; approving sends the ticked items in order", async () => {
    stubRoute(routes.cards.readCard, [cardView("ready"), cardView("approved")]);
    stubRoute(routes.cards.approveCard, { status: 200, body: { state: "approved" } });
    renderCard();
    const toggles = await screen.findAllByRole("checkbox", { name: "Use this in meetings" });
    const recall = screen.getByRole("switch", { name: RECALL_SWITCH_COPY });
    expect((recall as HTMLInputElement).checked).toBe(false);
    const third = toggles[2];
    const first = toggles[0];
    if (third === undefined || first === undefined)
      throw new Error("the card has fewer than three items");
    fireEvent.click(third);
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "Approve my card" }));
    expect(await screen.findByText("Card approved.")).toBeTruthy();
    expect(requestsTo(routes.cards.approveCard)[0]?.body).toEqual({
      itemIds: [itemId(1), itemId(3)],
      recallAllowed: false,
    });
    expect(readApprovedCard()).toBe(IDS.card);
  });

  it("D23-T1: a thin card shows the thin badge and no quiz button once approved", async () => {
    stubRoute(routes.cards.readCard, [
      cardView("thin"),
      { ...cardView("thin"), state: "approved" },
    ]);
    stubRoute(routes.cards.approveCard, { status: 200, body: { state: "approved" } });
    renderCard();
    const toggles = await screen.findAllByRole("checkbox", { name: "Use this in meetings" });
    const first = toggles[0];
    if (first === undefined) throw new Error("the thin card has no items");
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "Approve my card" }));
    expect(await screen.findByText("Card approved.")).toBeTruthy();
    expect(
      screen.getByText(
        "Your card is short: fewer than 6 items had a quote that checked out. Meetings still work; the quiz is skipped.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take the knows-me quiz" })).toBeNull();
    expect(
      within(screen.getByRole("main"))
        .getByRole("link", { name: "Invite a friend" })
        .getAttribute("href"),
    ).toBe(`/pair?card=${IDS.card}`);
  });

  it("R3.2-T1: tapping a quote opens a sheet with the full quote that closes again", async () => {
    const quote = "I said this in my own words, number 1";
    const text = `Hello. ${quote}.`;
    stubRoute(routes.cards.readCard, cardView("ready"));
    stubRoute(routes.cards.readItemSource, {
      status: 200,
      body: { turnIndex: 0, text, highlight: { start: 7, end: 7 + quote.length } },
    });
    renderCard();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Show the quote" }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(quote)).toBeTruthy();
    expect(within(dialog).getByText("Found word for word in your message.")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("R6.5-T2: an unverified item shows no receipt and cannot be ticked", async () => {
    const view = cardView("ready");
    const second = view.items[1];
    if (second === undefined) throw new Error("the card has no second item");
    view.items[1] = { ...second, verified: false, flagged: true };
    stubRoute(routes.cards.readCard, view);
    renderCard();
    const rows = await screen.findAllByRole("listitem");
    const row = rows[1];
    if (row === undefined) throw new Error("no second row");
    expect(row.textContent).toContain("no quote");
    expect(within(row).getByRole("checkbox", { name: "Use this in meetings" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("R3.4-T3: every control on the card page has an accessible name at 375 px", async () => {
    stubRoute(routes.cards.readCard, cardView("ready"));
    renderCard();
    await screen.findByText("Claim number 1");
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
