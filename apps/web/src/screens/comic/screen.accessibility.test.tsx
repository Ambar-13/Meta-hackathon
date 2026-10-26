import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { renderScreen } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS } from "../../testing/fixtures.js";
import { ComicScreen } from "./screen.js";

afterEach(() => {
  cleanup();
});

describe("comic placeholder", () => {
  it("R13.1-T4: the comic placeholder exports ComicScreen with its heading and the next-wave line", () => {
    renderScreen(<ComicScreen />, { pattern: ROUTE_PATTERNS.comic, url: APP_PATHS.comic(IDS.meeting) });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The comic");
    expect(screen.getByText("This part arrives in the next build wave.")).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
