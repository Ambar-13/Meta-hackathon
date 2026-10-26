import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { renderScreen } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS } from "../../testing/fixtures.js";
import { ConsentScreen } from "./consent-screen.js";
import { PublicSharePage } from "./public-page.js";

afterEach(() => {
  cleanup();
});

describe("share placeholders", () => {
  it("R13.1-T5: the consent placeholder exports ConsentScreen with its heading and the next-wave line", () => {
    renderScreen(<ConsentScreen />, { pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting) });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Share this meeting");
    expect(screen.getByText("This part arrives in the next build wave.")).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("R13.1-T6: the public page placeholder exports PublicSharePage with its heading and the next-wave line", () => {
    renderScreen(<PublicSharePage />, { pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage("abc") });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Shared meeting");
    expect(screen.getByText("This part arrives in the next build wave.")).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
