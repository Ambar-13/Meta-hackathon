import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { TRANSFER_TOKEN } from "../../testing/fixtures.js";
import { SettingsScreen } from "./screen.js";

afterEach(() => {
  cleanup();
});

describe("settings placeholder", () => {
  it("R9.2-T4: Settings makes a one-time Safari link and shows it with a copy action", async () => {
    const url = `http://localhost:3000/claim#${TRANSFER_TOKEN}`;
    stubRoute(routes.people.transfer, { status: 200, body: { url, expiresAt: "2026-10-27T10:10:00.000Z" } });
    renderScreen(<SettingsScreen />, { pattern: ROUTE_PATTERNS.settings, url: APP_PATHS.settings });
    fireEvent.click(screen.getByRole("button", { name: "Make a Safari link" }));
    expect(await screen.findByRole("textbox", { name: "One-time link" })).toHaveProperty("value", url);
    expect(screen.getByText("The link works once, for 10 minutes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(requestsTo(routes.people.transfer)).toHaveLength(1);
    expect(requestsTo(routes.people.transfer)[0]?.body).toBeNull();
  });

  it("R13.1-T7: the settings placeholder shows its heading and the next-wave line and no footer link to itself", () => {
    renderScreen(<SettingsScreen />, { pattern: ROUTE_PATTERNS.settings, url: "/settings" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings");
    expect(screen.getByText("This part arrives in the next build wave.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("R9.2-T5: every control on Settings has an accessible name at 375 px", async () => {
    stubRoute(routes.people.transfer, { status: 200, body: { url: `http://localhost:3000/claim#${TRANSFER_TOKEN}`, expiresAt: "2026-10-27T10:10:00.000Z" } });
    renderScreen(<SettingsScreen />, { pattern: ROUTE_PATTERNS.settings, url: "/settings" });
    expect(unlabelledControls(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Make a Safari link" }));
    await screen.findByRole("textbox", { name: "One-time link" });
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
