import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { HomeView } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, SERVER_NOW } from "../../testing/fixtures.js";
import { HomeScreen } from "./screen.js";

afterEach(() => {
  cleanup();
});

// A home view for person A with nothing in it yet; tests replace the fields they need.
function home(overrides: Partial<HomeView>): HomeView {
  return { displayName: "Mira", source: null, card: null, meetings: [], pairs: [], serverNow: SERVER_NOW, ...overrides };
}

// Renders home with one reply for GET /api/home.
function renderHome(view: HomeView | { status: number; body: unknown }): void {
  stubRoute(routes.people.readHome, view);
  renderScreen(<HomeScreen />, { pattern: ROUTE_PATTERNS.home, url: APP_PATHS.home });
}

// The main link of the next-step panel.
async function nextStepLink(name: string): Promise<string | null> {
  return (await within(await screen.findByRole("main")).findByRole("link", { name })).getAttribute("href");
}

const APPROVED_CARD = { id: IDS.card, state: "approved" as const, itemCount: 4, items: [{ kind: "habit" as const, claim: "Plans before building", quote: "I can't start until I know what done looks like." }] };
const MEETING = { id: IDS.meeting, questionText: "Would we enjoy a 10-day hackathon together?", questionKind: "get_along" as const, otherDisplayName: "Jonah", createdAt: SERVER_NOW };

describe("home screen", () => {
  it("HOME-WEB-T1 (design pass fix 4): a new person is sent to add their notes", async () => {
    renderHome(home({}));
    expect(await screen.findByRole("heading", { name: "Add your notes." })).toBeTruthy();
    expect(await nextStepLink("Add your notes")).toBe(APP_PATHS.upload);
    expect(screen.getByText("No meetings yet")).toBeTruthy();
  });

  it("HOME-WEB-T2: a source whose names are not reviewed leads to the names check", async () => {
    renderHome(home({ source: { id: IDS.source, namesPassDone: true, namesReviewed: false } }));
    expect(await nextStepLink("Check the names")).toBe(APP_PATHS.namesReview(IDS.source));
  });

  it("HOME-WEB-T3: a card that is ready leads to approving it, and the card shows as the person's name tag", async () => {
    renderHome(home({ source: { id: IDS.source, namesPassDone: true, namesReviewed: true }, card: { ...APPROVED_CARD, state: "ready" } }));
    expect(await nextStepLink("Review my card")).toBe(APP_PATHS.card(IDS.card));
    expect(screen.getByRole("link", { name: "Your card, 4 items" }).textContent).toContain("Plans before building");
  });

  it("HOME-WEB-T4: an approved card with nothing else offers to meet someone", async () => {
    renderHome(home({ source: { id: IDS.source, namesPassDone: true, namesReviewed: true }, card: APPROVED_CARD }));
    expect(await nextStepLink("Invite a friend")).toBe(`${APP_PATHS.pair}?card=${IDS.card}`);
    expect(screen.getByRole("link", { name: "Find people" }).getAttribute("href")).toBe(APP_PATHS.search);
  });

  it("HOME-WEB-T5: a running meeting comes first, and its row says it is talking now", async () => {
    renderHome(home({ card: APPROVED_CARD, source: { id: IDS.source, namesPassDone: true, namesReviewed: true }, meetings: [{ ...MEETING, state: "running", isBriefReady: false }] }));
    expect(await nextStepLink("Watch it")).toBe(APP_PATHS.meeting(IDS.meeting));
    expect(screen.getByText("Talking now")).toBeTruthy();
  });

  it("HOME-WEB-T6: an ended meeting with its brief leads to the brief, and never shows a number about a person", async () => {
    renderHome(home({ card: APPROVED_CARD, source: { id: IDS.source, namesPassDone: true, namesReviewed: true }, meetings: [{ ...MEETING, state: "ended", isBriefReady: true }] }));
    expect(await nextStepLink("Read the brief")).toBe(APP_PATHS.brief(IDS.meeting));
    expect(document.body.textContent?.includes("%")).toBe(false);
  });

  it("HOME-WEB-T7: no session shows the server's sentence and the way to the start page", async () => {
    renderHome({ status: 401, body: { code: "session_missing", message: "Sign in again to see this page." } });
    expect(await screen.findByText("Sign in again to see this page.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the start page" })).toBeTruthy();
  });

  it("HOME-WEB-T8: every control on home has an accessible name at 375 px", async () => {
    renderHome(home({ card: APPROVED_CARD, source: { id: IDS.source, namesPassDone: true, namesReviewed: true }, meetings: [{ ...MEETING, state: "ended", isBriefReady: true }], pairs: [{ id: IDS.pair, otherDisplayName: null, createdAt: SERVER_NOW, expiresAt: SERVER_NOW }] }));
    await screen.findByRole("heading", { name: "Your brief is ready." });
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
