import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { TRANSFER_TOKEN } from "../../testing/fixtures.js";
import { SettingsScreen } from "./screen.js";

// The deletion id the route answers with in these tests.
const DELETION_ID = "00000000-0000-4000-8000-000000000301";
// The dialog copy, byte for byte as the settings spec gives it.
const DIALOG_TITLE = "Delete everything we hold about you?";
const DIALOG_BODY =
  "This removes your uploaded excerpts, your card, your quizzes, your meetings, briefs, comics and any share page from our database. Anyone you met keeps their own excerpts and card, and loses the shared meeting, brief and share page. Your recovery code stops working. This cannot be undone.";
const DELETING = "Deleting. This takes a few seconds.";
const DELETED_NOTICE =
  "Your account is being deleted. Everything is removed within a few minutes. You can close this tab.";
const SESSION_ENDED = "Your session has ended. Open the app again to continue.";

afterEach(() => {
  cleanup();
});

// Renders the settings screen at the phone width and returns the trigger button of the delete flow.
function renderSettings(): HTMLElement {
  renderScreen(<SettingsScreen />, { pattern: ROUTE_PATTERNS.settings, url: APP_PATHS.settings });
  return screen.getByRole("button", { name: "Delete my account" });
}

// Opens the delete dialog from its trigger and returns the dialog element.
function openDialog(trigger: HTMLElement): HTMLElement {
  fireEvent.click(trigger);
  return screen.getByRole("dialog", { name: DIALOG_TITLE });
}

// Waits one short tick, so a second request would have been sent before the check reads the log.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("settings screen", () => {
  it("R9.2-T4: Settings makes a one-time Safari link and shows it with a copy action", async () => {
    const url = `http://localhost:3000/claim#${TRANSFER_TOKEN}`;
    stubRoute(routes.people.transfer, {
      status: 200,
      body: { url, expiresAt: "2026-10-27T10:10:00.000Z" },
    });
    renderScreen(<SettingsScreen />, { pattern: ROUTE_PATTERNS.settings, url: APP_PATHS.settings });
    fireEvent.click(screen.getByRole("button", { name: "Make a Safari link" }));
    expect(await screen.findByRole("textbox", { name: "One-time link" })).toHaveProperty(
      "value",
      url,
    );
    expect(screen.getByText("The link works once, for 10 minutes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(requestsTo(routes.people.transfer)).toHaveLength(1);
    expect(requestsTo(routes.people.transfer)[0]?.body).toBeNull();
  });

  it("R13.1-T7: the settings screen shows its heading and no footer link to itself", () => {
    renderScreen(<SettingsScreen />, { pattern: ROUTE_PATTERNS.settings, url: "/settings" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("R9.2-T5: every control on Settings has an accessible name at 375 px", async () => {
    stubRoute(routes.people.transfer, {
      status: 200,
      body: {
        url: `http://localhost:3000/claim#${TRANSFER_TOKEN}`,
        expiresAt: "2026-10-27T10:10:00.000Z",
      },
    });
    renderScreen(<SettingsScreen />, { pattern: ROUTE_PATTERNS.settings, url: "/settings" });
    expect(unlabelledControls(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Make a Safari link" }));
    await screen.findByRole("textbox", { name: "One-time link" });
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W2-DEL-T12 (R9.7): the dialog body says what the other person keeps and loses, verbatim", () => {
    const dialog = openDialog(renderSettings());

    expect(within(dialog).getByText(DIALOG_BODY)).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("W2-DEL-T13: focus lands on Keep my account when the dialog opens and returns to the trigger on cancel", () => {
    const trigger = renderSettings();
    trigger.focus();
    const dialog = openDialog(trigger);
    const keep = within(dialog).getByRole("button", { name: "Keep my account" });

    expect(document.activeElement).toBe(keep);
    fireEvent.click(keep);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("W2-DEL-T14: confirm calls DELETE /api/people/me once, shows the deleting copy, then the deleted notice on 202", async () => {
    stubRoute(routes.people.deleteMe, {
      status: 202,
      body: { deletionId: DELETION_ID },
      delayMs: 100,
    });
    const dialog = openDialog(renderSettings());
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    expect(await screen.findByText(DELETING)).toBeTruthy();
    expect(await screen.findByText(DELETED_NOTICE)).toBeTruthy();
    await settle();
    expect(requestsTo(routes.people.deleteMe)).toHaveLength(1);
  });

  it("W2-DEL-T15: a 401 shows the session-ended sentence and no retry loop", async () => {
    stubRoute(routes.people.deleteMe, {
      status: 401,
      body: { code: "unauthorized", message: "The session has ended." },
    });
    const dialog = openDialog(renderSettings());
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    expect(await screen.findByText(SESSION_ENDED)).toBeTruthy();
    await settle();
    expect(requestsTo(routes.people.deleteMe)).toHaveLength(1);
  });

  it("W2-DEL-T16: every control has a label at 375 px (horizontal overflow is not measured in jsdom)", () => {
    const dialog = openDialog(renderSettings());

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
    expect(within(dialog).getByRole("button", { name: "Keep my account" })).toBeTruthy();
  });
});
