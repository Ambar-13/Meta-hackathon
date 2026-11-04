import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { renderScreen } from "../../testing/index.js";
import { CookiesScreen, PrivacyScreen, TermsScreen } from "./index.js";

afterEach(() => {
  cleanup();
});

// The headings of the page on screen, level 2, in order.
function sectionHeadings(): (string | null)[] {
  return screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
}

// The links at the page's foot, by name and address.
function footLinks(): [string | null, string | null][] {
  const nav = screen.getByRole("navigation", { name: "Meety's policies" });
  return Array.from(nav.querySelectorAll("a")).map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
}

describe("the policy pages", () => {
  it("W7-PRIVACY-T1: /privacy says what Meety keeps, never the email, who sees what, how to delete it, and who to write to, with no app pages around it", () => {
    renderScreen(<PrivacyScreen />, { pattern: ROUTE_PATTERNS.privacy, url: APP_PATHS.privacy });

    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeTruthy();
    expect(sectionHeadings()).toEqual([
      "What Meety keeps",
      "What Meety does with it",
      "Who sees what",
      "Cookies and your browser",
      "Deleting it",
      "Questions",
    ]);
    expect(screen.getByText(/Never your email\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "hey.meety@gmail.com" }).getAttribute("href")).toBe(
      "mailto:hey.meety@gmail.com",
    );
    expect(footLinks()).toEqual([
      ["Terms", "/terms"],
      ["Cookies", "/cookies"],
      ["Back to Meety", "/"],
    ]);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  it("W7-TERMS-T1: /terms says what Meety is, that its answers are guesses, what is not allowed, what it promises and how to leave, and links the other two pages", () => {
    renderScreen(<TermsScreen />, { pattern: ROUTE_PATTERNS.terms, url: APP_PATHS.terms });

    expect(screen.getByRole("heading", { level: 1, name: "Terms" })).toBeTruthy();
    expect(sectionHeadings()).toEqual([
      "What Meety is",
      "Your account",
      "What you upload and post",
      "What is not allowed",
      "When the rules are broken",
      "What Meety promises",
      "Leaving",
      "Changes to these terms",
      "Questions",
    ]);
    expect(screen.getByText(/Its answers are guesses made by an AI\./)).toBeTruthy();
    expect(screen.getByText("Last changed 3 November 2026.")).toBeTruthy();
    expect(footLinks()).toEqual([
      ["Privacy", "/privacy"],
      ["Cookies", "/cookies"],
      ["Back to Meety", "/"],
    ]);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  it("W7-COOKIES-T1: /cookies lists the two cookies and the two notes with what each is for and how long it stays, and says there is nothing to accept", () => {
    renderScreen(<CookiesScreen />, { pattern: ROUTE_PATTERNS.cookies, url: APP_PATHS.cookies });

    expect(screen.getByRole("heading", { level: 1, name: "Cookies" })).toBeTruthy();
    expect(sectionHeadings()).toEqual([
      "The two cookies",
      "The two notes",
      "Google's own page",
      "Removing them",
      "Questions",
    ]);
    expect(Array.from(document.querySelectorAll("dt")).map((term) => term.textContent)).toEqual([
      "__Host-session",
      "__Host-google",
      "meet-first-stories-seen",
      "meet-first.access-code",
    ]);
    expect(screen.getByText("Lasts 90 days. Deleting your account removes it.")).toBeTruthy();
    expect(screen.getByText(/nothing to accept or refuse/)).toBeTruthy();
    expect(footLinks()).toEqual([
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Back to Meety", "/"],
    ]);
  });
});
