import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { renderScreen } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS } from "../../testing/fixtures.js";
import { BriefScreen } from "./screen.js";

afterEach(() => {
  cleanup();
});

describe("brief placeholder", () => {
  it("R13.1-T3: the brief placeholder exports BriefScreen with its heading and the next-wave line", () => {
    renderScreen(<BriefScreen />, { pattern: ROUTE_PATTERNS.brief, url: APP_PATHS.brief(IDS.meeting) });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your brief");
    expect(screen.getByText("This part arrives in the next build wave.")).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
