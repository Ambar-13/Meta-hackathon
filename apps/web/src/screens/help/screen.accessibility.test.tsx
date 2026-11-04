import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { HELP_SEND_COPY } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { HelpScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// The ask id the stubbed create route returns.
const ASK = "00000000-0000-4000-8000-000000000501";
// The problem the tests send.
const PROBLEM = "Our deploys fail at night and nobody knows why.";

// Renders the help page.
function renderHelp(): void {
  renderScreen(<HelpScreen />, { pattern: ROUTE_PATTERNS.help, url: APP_PATHS.help });
}

describe("help screen", () => {
  it("W6-ASKA-T28 (design section 7, P5): the help page shows the problem box, HELP_SEND_COPY after it and the send button, with every control labelled and no overflow at 375 px, with fake api replies", () => {
    renderHelp();

    const box = screen.getByLabelText("Your problem");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box.getAttribute("maxlength")).toBe("300");
    const words = screen.getByText(HELP_SEND_COPY);
    expect(box.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.getByRole("button", { name: "Find who could help" })).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  it("W6-ASKA-T29 (design section 7): a problem under 5 characters shows the length line and sends nothing, and a problem of 5 to 300 characters is sent trimmed and opens the answers page, with fake api replies", async () => {
    stubRoute(routes.asks.createAsk, { status: 201, body: { askId: ASK } });
    renderHelp();
    const box = screen.getByLabelText("Your problem");

    fireEvent.change(box, { target: { value: "Hm?" } });
    fireEvent.click(screen.getByRole("button", { name: "Find who could help" }));

    expect(screen.getByText("Write a problem of 5 to 300 characters.")).toBeTruthy();
    expect(requestsTo(routes.asks.createAsk)).toHaveLength(0);

    fireEvent.change(box, { target: { value: "  " + PROBLEM + "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Find who could help" }));

    await waitFor(() => {
      expect(requestsTo(routes.asks.createAsk)).toHaveLength(1);
    });
    expect(requestsTo(routes.asks.createAsk)[0]?.body).toEqual({ mode: "help", text: PROBLEM });
    expect((await screen.findByTestId("location")).textContent).toBe("/asks/" + ASK);
  });

  it("W6-ASKA-T30 (design section 5): a 429 help_daily_cap reply shows its sentence and the page stays, with fake api replies", async () => {
    stubRoute(routes.asks.createAsk, {
      status: 429,
      body: {
        code: "help_daily_cap",
        message: "You have used today's help searches. Try again tomorrow.",
      },
    });
    renderHelp();

    fireEvent.change(screen.getByLabelText("Your problem"), { target: { value: PROBLEM } });
    fireEvent.click(screen.getByRole("button", { name: "Find who could help" }));

    expect(
      await screen.findByText("You have used today's help searches. Try again tomorrow."),
    ).toBeTruthy();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Find who could help" }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
