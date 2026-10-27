import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, sourceView } from "../../testing/fixtures.js";
import { NamesReviewScreen } from "./screen.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Renders the names review for the fixture source.
function renderNames(): void {
  renderScreen(<NamesReviewScreen />, { pattern: ROUTE_PATTERNS.namesReview, url: APP_PATHS.namesReview(IDS.source) });
}

describe("names review screen", () => {
  it("R2.4-T1: the names list shows 20 per page with replace all preselected", async () => {
    stubRoute(routes.sources.readSource, [sourceView(1, 21), sourceView(2, 21)]);
    renderNames();
    expect(await screen.findByText("21 names found.")).toBeTruthy();
    expect(screen.getAllByText(/^Name \d+$/)).toHaveLength(20);
    expect(screen.getByRole("radio", { name: "Replace all names with role labels" })).toHaveProperty("checked", true);
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Name 21")).toBeTruthy();
    expect(requestsTo(routes.sources.readSource)[1]?.url).toContain("page=2");
  });

  it("R2.4-T2: keeping a name takes the choose mode and a row tap, and the review sends keep true for that name only", async () => {
    stubRoute(routes.sources.readSource, sourceView(1, 2));
    stubRoute(routes.sources.namesReview, { status: 200, body: { frozenAt: "2026-10-27T10:00:00.000Z", redactionCount: 3 } });
    stubRoute(routes.sources.requestCard, { status: 202, body: { cardId: IDS.card } });
    renderNames();
    await screen.findByText("2 names found.");
    expect(screen.queryByRole("checkbox", { name: "Keep Name 1" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Choose names to keep" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep Name 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and build my card" }));
    expect((await screen.findByTestId("location")).textContent).toBe(`/cards/${IDS.card}`);
    expect(requestsTo(routes.sources.namesReview)[0]?.body).toEqual({
      decisions: [
        { text: "Name 1", keep: true },
        { text: "Name 2", keep: false },
      ],
      sensitiveOptIn: [],
    });
  });

  it("D16-T1: the save button opens only once the names check has finished, using fake timers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    stubRoute(routes.sources.readSource, [{ ...sourceView(1, 1), namesPassDone: false }, sourceView(1, 1)]);
    renderNames();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("button", { name: "Save and build my card" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("The button opens when the names check has finished.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("button", { name: "Save and build my card" }).hasAttribute("disabled")).toBe(false);
  });

  it("D18-T1: the three opt-ins start unticked, a ticked one is sent, and minors are never offered", async () => {
    stubRoute(routes.sources.readSource, sourceView(1, 1));
    stubRoute(routes.sources.namesReview, { status: 200, body: { frozenAt: "2026-10-27T10:00:00.000Z", redactionCount: 1 } });
    stubRoute(routes.sources.requestCard, { status: 202, body: { cardId: IDS.card } });
    renderNames();
    await screen.findByText("1 name found.");
    for (const label of ["Health", "Home and street addresses", "ID and account numbers"]) {
      expect(screen.getByRole("checkbox", { name: label })).toHaveProperty("checked", false);
    }
    expect(screen.queryByLabelText(/minor/i)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Health" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and build my card" }));
    await screen.findByTestId("location");
    expect(requestsTo(routes.sources.namesReview)[0]?.body).toEqual({ decisions: [{ text: "Name 1", keep: false }], sensitiveOptIn: ["health"] });
  });

  it("R2.4-T3: every control on the names page has an accessible name at 375 px", async () => {
    stubRoute(routes.sources.readSource, sourceView(1, 3));
    renderNames();
    await screen.findByText("3 names found.");
    expect(unlabelledControls(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: "Choose names to keep" }));
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("design fix 3: while the first read is out, the screen shows only the looking line, and every control has a name", async () => {
    stubRoute(routes.sources.readSource, { status: 200, body: sourceView(1, 2), delayMs: 10_000 });
    renderNames();
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Looking for names in your notes.");
    expect(screen.queryByRole("button", { name: "Save and build my card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("design fix 3: a failed first read shows one sentence and Try again, which reads the source again and shows the list", async () => {
    stubRoute(routes.sources.readSource, [{ status: 404, body: null }, sourceView(1, 1)]);
    renderNames();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This no longer exists or is not yours.");
    expect(screen.queryByRole("button", { name: "Save and build my card" })).toBeNull();
    expect(unlabelledControls(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("1 name found.")).toBeTruthy();
    expect(requestsTo(routes.sources.readSource)).toHaveLength(2);
  });
});
