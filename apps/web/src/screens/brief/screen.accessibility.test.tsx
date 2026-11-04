import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { Brief, type BriefPoint, routes } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS } from "../../app-shell/index.js";
import { renderScreen, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { BriefScreen } from "./screen.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The meeting and the two notes the fixture brief cites.
const MEETING = "00000000-0000-4000-8000-000000000201";
const TURN_A = "00000000-0000-4000-8000-000000000301";
const TURN_B = "00000000-0000-4000-8000-000000000401";

// One brief line that cites one quote from the given note.
function point(spec: {
  text: string;
  side: "a" | "b";
  supported: boolean | null;
  verified?: boolean;
}): BriefPoint {
  const turnId = spec.side === "a" ? TURN_A : TURN_B;
  const isVerified = spec.verified ?? true;
  return {
    text: spec.text,
    quotes: [
      {
        text: `A quote from side ${spec.side} that carries the line about ${spec.text.toLowerCase()}.`,
        side: spec.side,
        turnId,
        verified: isVerified,
      },
    ],
    supported: spec.supported,
  };
}

// The brief the fixture screen shows: one unsupported clash line, and every line backed except that
// one, so the rate is 8 of 9.
function briefFixture(): Brief {
  return Brief.parse({
    agree: [
      point({ text: "Both of you plan first", side: "a", supported: true }),
      point({ text: "Both of you say so early", side: "a", supported: true }),
      point({ text: "Both of you keep notes", side: "b", supported: true }),
    ],
    clash: [
      point({ text: "You differ on deadlines", side: "a", supported: true }),
      point({ text: "You differ on thinking aloud", side: "b", supported: false }),
      point({ text: "You differ on weekends", side: "b", supported: true }),
    ],
    decideFirst: [
      point({ text: "Settle who writes the plan", side: "a", supported: true }),
      point({ text: "Settle the deadline rule", side: "b", supported: true }),
      point({ text: "Settle the weekend rule", side: "a", supported: true }),
    ],
    supportRate: 0.889,
    supportReliable: true,
    questionKind: "decision",
  });
}

// Renders the brief page for the fixture meeting and waits until the brief has loaded.
async function renderBrief(): Promise<void> {
  renderScreen(<BriefScreen />, { pattern: ROUTE_PATTERNS.brief, url: APP_PATHS.brief(MEETING) });
  await screen.findByRole("heading", { name: "Where you agree" });
}

// The section that starts with a heading of this name.
function sectionTitled(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  if (section === null) throw new Error(`no section titled ${name}`);
  return section;
}

describe("brief screen", () => {
  it("W2-BRIEF-T17 (A1): the weak receipt mark is readable without colour", async () => {
    stubRoute(routes.briefs.readBrief, briefFixture());
    await renderBrief();
    const secondClashLine = within(sectionTitled("Where you clash")).getAllByRole("listitem")[1];
    expect(secondClashLine).toBeTruthy();
    const mark = within(secondClashLine as HTMLElement).getByRole("note");
    expect(mark.textContent).toBe("weak quote");
  });

  it("W2-BRIEF-T18 (invariant 19): an unsupported decide-first line is absent from Decide this first and present under Set aside with the weak receipt mark", async () => {
    const brief = briefFixture();
    stubRoute(routes.briefs.readBrief, {
      ...brief,
      decideFirst: brief.decideFirst.map((line, index) =>
        index === 0 ? { ...line, supported: false } : line,
      ),
    });
    await renderBrief();
    expect(within(sectionTitled("Decide this first")).getAllByRole("listitem")).toHaveLength(2);
    const setAside = within(sectionTitled("Set aside")).getAllByRole("listitem");
    expect(setAside).toHaveLength(1);
    expect(within(setAside[0] as HTMLElement).getByRole("note").textContent).toBe("weak quote");
  });

  it("W2-BRIEF-T19 (R6.5): an unverified quote shows no receipt and still opens the quote sheet", async () => {
    const brief = briefFixture();
    const first = brief.agree[0];
    if (first === undefined) throw new Error("the fixture has no agree line");
    stubRoute(routes.briefs.readBrief, {
      ...brief,
      agree: [
        { ...first, quotes: first.quotes.map((quote) => ({ ...quote, verified: false })) },
        brief.agree[1],
        brief.agree[2],
      ],
    });
    await renderBrief();
    const chip = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("no quote"));
    expect(chip).toBeTruthy();
    fireEvent.click(chip as HTMLElement);
    const sheet = screen.getByRole("dialog");
    expect(sheet.textContent).toContain("This quote did not match the named turn.");
    expect(sheet.textContent).toContain(first.quotes[0]?.text ?? "");
  });

  it("W2-BRIEF-T20 (A1 copy): the support rate is shown as a rate and never as a percentage or proof", async () => {
    stubRoute(routes.briefs.readBrief, briefFixture());
    await renderBrief();
    expect(
      screen.getByText("Support rate 0.89: 8 of 9 lines are backed by their quote."),
    ).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text.includes("%")).toBe(false);
    expect(text.toLowerCase().includes("proof")).toBe(false);
  });

  it("W2-BRIEF-T21 (R3.4 polling): the waiting copy shows on 404 brief_not_ready and the brief appears after the stub flips, using a fake timer", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.briefs.readBrief, [
      {
        status: 404,
        body: {
          code: "brief_not_ready",
          message: "The brief is not written yet. Ask again in a few seconds.",
        },
      },
      briefFixture(),
    ]);
    renderScreen(<BriefScreen />, { pattern: ROUTE_PATTERNS.brief, url: APP_PATHS.brief(MEETING) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Writing your brief. This takes about a minute.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("heading", { name: "Where you agree" })).toBeTruthy();
    expect(screen.queryByText("Writing your brief. This takes about a minute.")).toBeNull();
  });

  it("R10.5-T6: a get-along brief names its sections for getting along", async () => {
    stubRoute(routes.briefs.readBrief, { ...briefFixture(), questionKind: "get_along" });
    renderScreen(<BriefScreen />, { pattern: ROUTE_PATTERNS.brief, url: APP_PATHS.brief(MEETING) });
    for (const name of ["Where you'd click", "Where you'd rub", "What to talk about first"])
      expect(await screen.findByRole("heading", { name })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Where you agree" })).toBeNull();
  });

  it("W2-BRIEF-T22: every control has a label and the screen has no horizontal overflow at 375 px", async () => {
    stubRoute(routes.briefs.readBrief, briefFixture());
    await renderBrief();
    expect(unlabelledControls(document.body)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
