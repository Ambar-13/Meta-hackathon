import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { routes, ShareSnapshot } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { IDS, meetingView } from "../../testing/fixtures.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { ConsentScreen } from "./consent-screen.js";
import { PublicSharePage } from "./public-page.js";

// The explainer, word for word from the copy table (4.7).
const CONSENT_EXPLAINER = "Publishing makes a page anyone with the link can read. It shows your display names, the question, the card items you approved, what the two personas said, and the brief lines that passed the support check with their quotes. It never shows your archive, redacted text, quiz answers or anything you did not approve. Either of you can take it down at any time; the page disappears on the next visit.";
// The slug of the fixture page: 22 URL-safe characters.
const SLUG = "AAAAAAAAAAAAAAAAAAAAAA";
// The question of the fixture page.
const QUESTION = "Who decides when we disagree and cannot wait?";

// A public snapshot that parses as ShareSnapshot, with one line per brief section.
function snapshotFixture(overrides: Partial<ShareSnapshot> = {}): ShareSnapshot {
  return ShareSnapshot.parse({
    question: QUESTION,
    questionKind: "decision",
    people: [
      { side: "a", displayName: "Test A" },
      { side: "b", displayName: "Test B" },
    ],
    items: [{ side: "a", kind: "value", claim: "Writes the plan first", quote: "I always write the plan down" }],
    turns: [{ side: "a", text: "I always write **the plan** down.", claims: [{ text: "Writes the plan first", quote: "I always write the plan down" }] }],
    brief: {
      agree: [{ text: "Both like clear deadlines", quotes: [{ text: "Deadlines matter to me", side: "a" }] }],
      clash: [{ text: "Plans differ on lead time", quotes: [{ text: "I need a day to adjust", side: "b" }] }],
      decideFirst: [{ text: "Pick the deadline first", quotes: [{ text: "Deadlines are guides", side: "b" }] }],
    },
    ...overrides,
  });
}

describe("consent screen", () => {
  it("W2-SHARE-T11: the consent screen shows the explainer verbatim and the consent button before consent, the waiting status after, and the link with Copy link when published", async () => {
    stubRoute(routes.meetings.readMeeting, meetingView({ state: "ended" }));
    stubRoute(routes.briefs.consent, { consentA: true, consentB: false, published: false });
    renderScreen(<ConsentScreen />, { pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting) });
    expect(await screen.findByText(CONSENT_EXPLAINER)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "I consent to publish" }));
    expect(await screen.findByText("You have consented. Waiting for the other person.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take the page down" })).toBeTruthy();
    expect(requestsTo(routes.briefs.consent)).toHaveLength(1);
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W2-SHARE-T11b: the consent screen shows the published line, the share link and Copy link once the page is live", async () => {
    stubRoute(routes.meetings.readMeeting, meetingView({ state: "ended" }));
    stubRoute(routes.briefs.consent, { consentA: true, consentB: true, published: true, slug: SLUG });
    renderScreen(<ConsentScreen />, { pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting) });
    fireEvent.click(await screen.findByRole("button", { name: "I consent to publish" }));
    expect(await screen.findByText("Published. Anyone with the link can read it.")).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/share/${SLUG}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W2-SHARE-T11c: the consent screen says consent opens when both briefs are written, with no button, while the meeting is not ended", async () => {
    stubRoute(routes.meetings.readMeeting, meetingView({ state: "running" }));
    renderScreen(<ConsentScreen />, { pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting) });
    expect(await screen.findByText("Consent opens when both briefs are written.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I consent to publish" })).toBeNull();
  });
});

describe("public share page", () => {
  it("W2-SHARE-T12: the public page renders display names only, the three brief sections, and a Report this page link with a real href", async () => {
    stubRoute(routes.briefs.readShare, snapshotFixture());
    renderScreen(<PublicSharePage />, { pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG) });
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(QUESTION);
    expect(screen.getAllByText("A: Test A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B: Test B").length).toBeGreaterThan(0);
    for (const heading of ["Who met", "What the personas said", "The brief, lines the support check backed"]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeTruthy();
    }
    for (const section of ["Where you agree", "Where you clash", "Decide this first"]) {
      expect(screen.getByRole("heading", { level: 3, name: section })).toBeTruthy();
    }
    const report = screen.getByRole("link", { name: "Report this page" });
    expect(report.getAttribute("href")).not.toBe("#");
    expect(report.getAttribute("href")).not.toBe("");
    const text = document.body.textContent;
    for (const id of [IDS.meeting, IDS.personA, IDS.personB]) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toContain("%");
    expect(text).not.toContain("proof");
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W2-SHARE-T13: a 404 renders the not-found sentence and no error toast", async () => {
    stubRoute(routes.briefs.readShare, { status: 404, body: { code: "share_not_found", message: "No page here. It may have been taken down." } });
    renderScreen(<PublicSharePage />, { pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG) });
    expect(await screen.findByText("No page here. It may have been taken down.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("W2-SHARE-T14: turn text with a markdown link renders no anchor inside the turn (D66)", async () => {
    const linkText = "See [the notes](https://example.com/notes) now.";
    stubRoute(routes.briefs.readShare, snapshotFixture({ turns: [{ side: "a", text: linkText, claims: [] }] }));
    renderScreen(<PublicSharePage />, { pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG) });
    await screen.findByRole("heading", { level: 1 });
    const turn = document.querySelector(".safe-markdown");
    expect(turn).not.toBeNull();
    expect(turn?.querySelectorAll("a")).toHaveLength(0);
    expect(turn?.textContent).toContain("[the notes](https://example.com/notes)");
  });

  it("W2-SHARE-T15: at 375 px the comic images have alt text equal to their captions and a width that fits the column", async () => {
    stubRoute(
      routes.briefs.readShare,
      snapshotFixture({
        comic: [
          { caption: "First panel caption", imageUrl: "data:image/webp;base64,AAAA" },
          { caption: "Second panel caption", imageUrl: "data:image/webp;base64,BBBB" },
        ],
      }),
    );
    renderScreen(<PublicSharePage />, { pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG), width: 375 });
    await screen.findByRole("heading", { level: 1 });
    const images = Array.from(document.querySelectorAll("img"));
    expect(images.map((image) => image.getAttribute("alt"))).toEqual(["First panel caption", "Second panel caption"]);
    for (const image of images) {
      expect(image.style.maxWidth).toBe("100%");
    }
    expect(window.innerWidth).toBe(375);
  });
});
