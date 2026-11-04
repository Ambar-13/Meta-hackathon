import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Brief, routes, ShareSnapshot, type BriefPoint } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { IDS, meetingView } from "../../testing/fixtures.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { ConsentScreen } from "./consent-screen.js";
import { PublicSharePage } from "./public-page.js";

// The explainer, word for word from the copy table.
const CONSENT_EXPLAINER =
  "Publishing makes a page anyone with the link can read. It shows your display names, the question, the card items you approved, what the two Meetys said, and the brief lines that passed the support check with their quotes. It never shows your archive, redacted text, quiz answers or anything you did not approve. Either of you can take it down at any time; the page disappears on the next visit.";
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
    items: [
      {
        side: "a",
        kind: "value",
        claim: "Writes the plan first",
        quote: "I always write the plan down",
      },
    ],
    turns: [
      {
        side: "a",
        text: "I always write **the plan** down.",
        claims: [{ text: "Writes the plan first", quote: "I always write the plan down" }],
      },
    ],
    brief: {
      agree: [
        {
          text: "Both like clear deadlines",
          quotes: [{ text: "Deadlines matter to me", side: "a" }],
        },
      ],
      clash: [
        {
          text: "Plans differ on lead time",
          quotes: [{ text: "I need a day to adjust", side: "b" }],
        },
      ],
      decideFirst: [
        { text: "Pick the deadline first", quotes: [{ text: "Deadlines are guides", side: "b" }] },
      ],
    },
    ...overrides,
  });
}

// The two people of the preview fixture meeting.
const PREVIEW_MEMBERS = [
  { side: "a", displayName: "Mira", ready: true, connected: false },
  { side: "b", displayName: "Jonah", ready: true, connected: false },
] as const;
// The brief line of the fixture that passed the support check, with its quote.
const BACKED_LINE = "Both like clear deadlines";
const BACKED_QUOTE = "Deadlines matter to me";
// Lines the support check did not back, could not decide, or whose quote was not found; none of them may be previewed.
const HELD_BACK_LINES = [
  "Plans differ on lead time",
  "Pick the deadline first",
  "Both like a quiet room",
];

// One brief line on side a's quote; supported and verified say how the support check and the quote check went.
function briefPoint(
  text: string,
  quote: string,
  check: { supported: boolean | null; verified: boolean },
): BriefPoint {
  return {
    text,
    quotes: [{ text: quote, side: "a", turnId: IDS.turnA, verified: check.verified }],
    supported: check.supported,
  };
}

// A brief with one backed line and three held back; isAllUnsupported turns the backed line into one the check refused too.
function briefFixture(options: { isAllUnsupported: boolean }): Brief {
  const filler = (index: number): BriefPoint =>
    briefPoint(`Filler line ${String(index)}`, "Filler quote", {
      supported: false,
      verified: true,
    });
  return Brief.parse({
    agree: [
      briefPoint(BACKED_LINE, BACKED_QUOTE, {
        supported: !options.isAllUnsupported,
        verified: true,
      }),
      briefPoint(HELD_BACK_LINES[2] ?? "", "Mornings are quiet", {
        supported: true,
        verified: false,
      }),
      filler(1),
    ],
    clash: [
      briefPoint(HELD_BACK_LINES[0] ?? "", "I need a day to adjust", {
        supported: false,
        verified: true,
      }),
      filler(2),
      filler(3),
    ],
    decideFirst: [
      briefPoint(HELD_BACK_LINES[1] ?? "", "Deadlines are guides", {
        supported: null,
        verified: true,
      }),
      filler(4),
      filler(5),
    ],
    supportRate: 0.5,
    supportReliable: true,
    questionKind: "decision",
  });
}

// Renders the consent screen on an ended meeting between Mira and Jonah, with the brief reply given.
function renderConsentWithBrief(brief: Parameters<typeof stubRoute>[1]): void {
  stubRoute(
    routes.meetings.readMeeting,
    meetingView({
      state: "ended",
      questionText: QUESTION,
      questionKind: "decision",
      members: [...PREVIEW_MEMBERS],
    }),
  );
  stubRoute(routes.briefs.readBrief, brief);
  renderScreen(<ConsentScreen />, {
    pattern: ROUTE_PATTERNS.consent,
    url: APP_PATHS.consent(IDS.meeting),
  });
}

describe("consent screen preview (design fix 2: the consent screen shows the excerpts it promises)", () => {
  it("DESIGN-SHARE-T1: above the consent button the preview shows both names, the question, and only the brief lines that passed the support check with their quotes", async () => {
    renderConsentWithBrief(briefFixture({ isAllUnsupported: false }));
    const preview = (
      await screen.findByRole("heading", { level: 2, name: "What the page will show" })
    ).closest("section");
    if (preview === null) throw new Error("the preview is not inside a section");
    expect(await within(preview).findByText(BACKED_LINE)).toBeTruthy();
    expect(within(preview).getByText("Mira and Jonah")).toBeTruthy();
    expect(within(preview).getByText(QUESTION)).toBeTruthy();
    expect(within(preview).getByText(BACKED_QUOTE)).toBeTruthy();
    expect(
      within(preview).getByRole("heading", { level: 3, name: "Where you agree" }),
    ).toBeTruthy();
    for (const line of [...HELD_BACK_LINES, "Filler line 1"]) {
      expect(within(preview).queryByText(line)).toBeNull();
    }
    expect(within(preview).getByText(/will appear too\.$/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "I consent to publish" });
    expect(preview.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.getByText(CONSENT_EXPLAINER)).toBeTruthy();
    expect(requestsTo(routes.briefs.readBrief)).toHaveLength(1);
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("DESIGN-SHARE-T2: when no line passed the support check the preview says so and the consent button stays", async () => {
    renderConsentWithBrief(briefFixture({ isAllUnsupported: true }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "No brief lines to publish" }),
    ).toBeTruthy();
    expect(screen.queryByText(BACKED_LINE)).toBeNull();
    expect(screen.getByRole("button", { name: "I consent to publish" })).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("DESIGN-SHARE-T3: a brief that cannot be read shows the server's sentence in the preview and the consent button stays", async () => {
    renderConsentWithBrief({
      status: 500,
      body: { code: "server_error", message: "Something went wrong on our side." },
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Something went wrong on our side.",
    );
    expect(screen.getByText("Mira and Jonah")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I consent to publish" })).toBeTruthy();
  });

  it("DESIGN-SHARE-T4: a meeting that is not ended reads no brief and shows no preview", async () => {
    stubRoute(routes.meetings.readMeeting, meetingView({ state: "running" }));
    renderScreen(<ConsentScreen />, {
      pattern: ROUTE_PATTERNS.consent,
      url: APP_PATHS.consent(IDS.meeting),
    });
    expect(await screen.findByText("Consent opens when both briefs are written.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "What the page will show" })).toBeNull();
    expect(requestsTo(routes.briefs.readBrief)).toHaveLength(0);
  });
});

describe("consent screen", () => {
  it("W2-SHARE-T11: the consent screen shows the explainer verbatim and the consent button before consent, the waiting status after, and the link with Copy link when published", async () => {
    stubRoute(routes.meetings.readMeeting, meetingView({ state: "ended" }));
    stubRoute(routes.briefs.readBrief, briefFixture({ isAllUnsupported: false }));
    stubRoute(routes.briefs.consent, { consentA: true, consentB: false, published: false });
    renderScreen(<ConsentScreen />, {
      pattern: ROUTE_PATTERNS.consent,
      url: APP_PATHS.consent(IDS.meeting),
    });
    expect(await screen.findByText(CONSENT_EXPLAINER)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "I consent to publish" }));
    expect(
      await screen.findByText("You have consented. Waiting for the other person."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take the page down" })).toBeTruthy();
    expect(requestsTo(routes.briefs.consent)).toHaveLength(1);
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W2-SHARE-T11b: the consent screen shows the published line, the share link and Copy link once the page is live", async () => {
    stubRoute(routes.meetings.readMeeting, meetingView({ state: "ended" }));
    stubRoute(routes.briefs.readBrief, briefFixture({ isAllUnsupported: false }));
    stubRoute(routes.briefs.consent, {
      consentA: true,
      consentB: true,
      published: true,
      slug: SLUG,
    });
    renderScreen(<ConsentScreen />, {
      pattern: ROUTE_PATTERNS.consent,
      url: APP_PATHS.consent(IDS.meeting),
    });
    fireEvent.click(await screen.findByRole("button", { name: "I consent to publish" }));
    expect(await screen.findByText("Published. Anyone with the link can read it.")).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/share/${SLUG}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W2-SHARE-T11c: the consent screen says consent opens when both briefs are written, with no button, while the meeting is not ended", async () => {
    stubRoute(routes.meetings.readMeeting, meetingView({ state: "running" }));
    renderScreen(<ConsentScreen />, {
      pattern: ROUTE_PATTERNS.consent,
      url: APP_PATHS.consent(IDS.meeting),
    });
    expect(await screen.findByText("Consent opens when both briefs are written.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I consent to publish" })).toBeNull();
  });
});

describe("public share page", () => {
  it("W2-SHARE-T12: the public page renders display names only, the three brief sections, and a Report this page link with a real href", async () => {
    stubRoute(routes.briefs.readShare, snapshotFixture());
    renderScreen(<PublicSharePage />, {
      pattern: ROUTE_PATTERNS.sharePage,
      url: APP_PATHS.sharePage(SLUG),
    });
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(QUESTION);
    expect(screen.getAllByText("A: Test A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B: Test B").length).toBeGreaterThan(0);
    for (const heading of [
      "Who met",
      "What the Meetys said",
      "The brief, lines the support check backed",
    ]) {
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
    stubRoute(routes.briefs.readShare, {
      status: 404,
      body: { code: "share_not_found", message: "No page here. It may have been taken down." },
    });
    renderScreen(<PublicSharePage />, {
      pattern: ROUTE_PATTERNS.sharePage,
      url: APP_PATHS.sharePage(SLUG),
    });
    expect(await screen.findByText("No page here. It may have been taken down.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("W2-SHARE-T14: turn text with a markdown link renders no anchor inside the turn (D66)", async () => {
    const linkText = "See [the notes](https://example.com/notes) now.";
    stubRoute(
      routes.briefs.readShare,
      snapshotFixture({ turns: [{ side: "a", text: linkText, claims: [] }] }),
    );
    renderScreen(<PublicSharePage />, {
      pattern: ROUTE_PATTERNS.sharePage,
      url: APP_PATHS.sharePage(SLUG),
    });
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
    renderScreen(<PublicSharePage />, {
      pattern: ROUTE_PATTERNS.sharePage,
      url: APP_PATHS.sharePage(SLUG),
      width: 375,
    });
    await screen.findByRole("heading", { level: 1 });
    const images = Array.from(document.querySelectorAll("img"));
    expect(images.map((image) => image.getAttribute("alt"))).toEqual([
      "First panel caption",
      "Second panel caption",
    ]);
    for (const image of images) {
      expect(image.style.maxWidth).toBe("100%");
    }
    expect(window.innerWidth).toBe(375);
  });
});
