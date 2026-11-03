import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { renderScreen } from "../../testing/index.js";
import { PrivacyScreen } from "./screen.js";

afterEach(() => {
  cleanup();
});

describe("the privacy page", () => {
  it("W7-PRIVACY-T1: /privacy says what Meety keeps, never the email, who sees what, how to delete it, and who to write to, with no app pages around it", () => {
    renderScreen(<PrivacyScreen />, { pattern: ROUTE_PATTERNS.privacy, url: APP_PATHS.privacy });

    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "What Meety keeps", "What Meety does with it", "Who sees what", "Cookies and your browser", "Deleting it", "Questions",
    ]);
    expect(screen.getByText(/Never your email\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "hey.meety@gmail.com" }).getAttribute("href")).toBe("mailto:hey.meety@gmail.com");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });
});
