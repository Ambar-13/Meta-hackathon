import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  AskView,
  HELP_RESULTS_HEADING,
  type AnswerClaim,
  type AskAnswer,
} from "@meet-first/contracts";
import {
  APP_PATHS,
  clearClientState,
  rememberApprovedCard,
  ROUTE_PATTERNS,
  routes,
} from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, SERVER_NOW } from "../../testing/fixtures.js";
import { AskScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The fixed ask and answer ids of this file.
const ASK = "00000000-0000-4000-8000-000000000501";
const ANSWER_IDS = {
  mira: "00000000-0000-4000-8000-000000000511",
  dev: "00000000-0000-4000-8000-000000000512",
  sol: "00000000-0000-4000-8000-000000000513",
  ana: "00000000-0000-4000-8000-000000000514",
} as const;
// The text of the fixture ask.
const ASK_TEXT = "Our deploys fail at night and nobody knows why.";
// One claim of each receipt kind: backed, verified but not backed, verified and not checked, and
// not verified.
const BACKED: AnswerClaim = {
  text: "Reads the logs before guessing",
  quote: "I always read the logs before I guess at a cause.",
  verified: true,
  supported: true,
};
const NOT_BACKED: AnswerClaim = {
  text: "Likes night shifts",
  quote: "Night shifts are when I think best.",
  verified: true,
  supported: false,
};
const NOT_CHECKED: AnswerClaim = {
  text: "Writes runbooks",
  quote: "I write a runbook after every outage.",
  verified: true,
  supported: null,
};
const UNVERIFIED: AnswerClaim = {
  text: "Has led a large team",
  quote: "I led a large team once.",
  verified: false,
  supported: null,
};
// The line shown in place of the meeting button when this phone knows no card.
const NO_CARD_LINE =
  "Open your approved card on this phone first, then come back here to start a meeting.";

// One help answer of the fixture.
function helpAnswer(spec: {
  answerId: string;
  name: string;
  line: string;
  position: number | null;
  canMeet: boolean;
  claims: AnswerClaim[];
}): AskAnswer {
  return {
    answerId: spec.answerId,
    displayName: spec.name,
    line: spec.line,
    answer: `${spec.name}'s persona would probably read the logs first.`,
    claims: spec.claims,
    hasSign: spec.position !== null,
    position: spec.position,
    canMeet: spec.canMeet,
  };
}

// The fixture ask with the given fields replaced: a done help search with no answers unless told
// otherwise.
function askView(overrides: Partial<AskView>): AskView {
  return AskView.parse({
    askId: ASK,
    mode: "help",
    text: ASK_TEXT,
    state: "done",
    refusedReason: null,
    aboutName: null,
    answers: [],
    createdAt: SERVER_NOW,
    ...overrides,
  });
}

// The four answers of a finished help search: Mira and Dev placed and meetable, Sol and Ana with no
// position.
function fourAnswers(): AskAnswer[] {
  return [
    helpAnswer({
      answerId: ANSWER_IDS.mira,
      name: "Mira",
      line: "I fix flaky deploys.",
      position: 1,
      canMeet: true,
      claims: [BACKED],
    }),
    helpAnswer({
      answerId: ANSWER_IDS.dev,
      name: "Dev",
      line: "I keep servers calm.",
      position: 2,
      canMeet: true,
      claims: [NOT_BACKED, NOT_CHECKED],
    }),
    helpAnswer({
      answerId: ANSWER_IDS.sol,
      name: "Sol",
      line: "I like quiet tools.",
      position: null,
      canMeet: false,
      claims: [UNVERIFIED],
    }),
    helpAnswer({
      answerId: ANSWER_IDS.ana,
      name: "Ana",
      line: "I teach testing.",
      position: null,
      canMeet: false,
      claims: [],
    }),
  ];
}

// Renders the answers page at the given address: the fixture ask with no card query unless told
// otherwise.
function renderAsk(url: string = APP_PATHS.ask(ASK)): void {
  renderScreen(<AskScreen />, { pattern: ROUTE_PATTERNS.ask, url });
}

// The list item of the answer whose heading is this name.
function itemOf(name: string): HTMLElement {
  const item = screen.getByRole("heading", { name }).closest("li");
  if (item === null) throw new Error(`no answer titled ${name}`);
  return item;
}

// The section that starts with a heading of this name.
function sectionOf(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  if (section === null) throw new Error(`no section titled ${name}`);
  return section;
}

// Lets the fake timers run for a number of milliseconds, flushing the pending requests.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// The address of the answers page with the fixture card in its card query.
const CARD_URL = APP_PATHS.ask(ASK) + "?card=" + IDS.card;

describe("ask screen", () => {
  it("W6-ASKA-T31 (design section 7): the page reads the ask every 3,000 ms while it runs and stops when it is done, using fake timers and fake api replies", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.asks.readAsk, [
      askView({ state: "checking" }),
      askView({ state: "asking" }),
      askView({ state: "ranking" }),
      askView({ answers: fourAnswers() }),
    ]);

    renderAsk();

    await advance(0);
    expect(requestsTo(routes.asks.readAsk)).toHaveLength(1);
    expect(screen.getByText("Checking your question.")).toBeTruthy();
    await advance(3000);
    expect(requestsTo(routes.asks.readAsk)).toHaveLength(2);
    expect(screen.getByText("Asking their Meetys. This takes about a minute.")).toBeTruthy();
    await advance(3000);
    expect(requestsTo(routes.asks.readAsk)).toHaveLength(3);
    expect(screen.getByText("Checking the quotes in each answer.")).toBeTruthy();
    await advance(3000);
    expect(requestsTo(routes.asks.readAsk)).toHaveLength(4);
    expect(screen.getByRole("heading", { name: HELP_RESULTS_HEADING })).toBeTruthy();
    await advance(9000);
    expect(requestsTo(routes.asks.readAsk)).toHaveLength(4);
  });

  it("W6-ASKA-T32 (design section 7): a done help search shows the placed answers under HELP_RESULTS_HEADING and the rest under No clear sign in their notes, with Start a meeting only on canMeet answers, with fake api replies", async () => {
    stubRoute(routes.asks.readAsk, askView({ answers: fourAnswers() }));

    renderAsk(CARD_URL);
    await screen.findByRole("heading", { name: HELP_RESULTS_HEADING });

    const placed = within(sectionOf(HELP_RESULTS_HEADING))
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    const unplaced = within(sectionOf("No clear sign in their notes"))
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(placed).toEqual(["Mira", "Dev"]);
    expect(unplaced).toEqual(["Sol", "Ana"]);
    expect(within(itemOf("Mira")).getByText("I fix flaky deploys.")).toBeTruthy();
    expect(
      within(itemOf("Mira")).getByText("Mira's persona would probably read the logs first."),
    ).toBeTruthy();
    const quotes = within(itemOf("Mira")).getAllByText(BACKED.quote, { selector: "blockquote" });
    expect(quotes).toHaveLength(1);
    expect(within(itemOf("Mira")).getAllByRole("button", { name: "Start a meeting" })).toHaveLength(
      1,
    );
    expect(within(itemOf("Dev")).getAllByRole("button", { name: "Start a meeting" })).toHaveLength(
      1,
    );
    expect(within(itemOf("Sol")).queryAllByRole("button")).toHaveLength(0);
    expect(within(itemOf("Ana")).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Start a meeting" })).toHaveLength(2);
    expect(screen.getByText("You asked: " + ASK_TEXT)).toBeTruthy();
  });

  it("W6-ASKA-T33 (design section 7): receipt marks are text with role note: no receipt for an unverified quote, weak receipt for a verified quote the check did not back or did not check, none for a backed one, with fake api replies", async () => {
    stubRoute(routes.asks.readAsk, askView({ answers: fourAnswers() }));

    renderAsk(CARD_URL);
    await screen.findByRole("heading", { name: HELP_RESULTS_HEADING });

    expect(within(itemOf("Mira")).queryAllByRole("note")).toHaveLength(0);
    expect(
      within(itemOf("Dev"))
        .getAllByRole("note")
        .map((note) => note.textContent),
    ).toEqual(["weak quote", "weak quote"]);
    expect(
      within(itemOf("Sol"))
        .getAllByRole("note")
        .map((note) => note.textContent),
    ).toEqual(["no quote"]);
    expect(within(itemOf("Ana")).getByText("No quotes from their notes.")).toBeTruthy();
    expect(within(itemOf("Ana")).queryAllByRole("note")).toHaveLength(0);
  });

  it("W6-ASKA-T34 (design section 10): the page shows no number about a person: no digit in the page text and no numbered list, with fake api replies", async () => {
    stubRoute(routes.asks.readAsk, askView({ answers: fourAnswers() }));

    renderAsk(CARD_URL);
    await screen.findByRole("heading", { name: HELP_RESULTS_HEADING });

    expect(/[0-9]/.test(document.querySelector("main")?.textContent ?? "")).toBe(false);
    expect(document.querySelectorAll("ol")).toHaveLength(0);
  });

  it("W6-ASKA-T35 (design section 7): with no answer the page shows No listed persona matches this yet, and with no placed answer it shows the none-placed line and the no-clear-sign section, with fake api replies", async () => {
    stubRoute(routes.asks.readAsk, askView({ answers: [] }));
    renderAsk();

    expect(await screen.findByText("Nobody in Explore matches this yet.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "No clear sign in their notes" })).toBeNull();
    cleanup();

    stubRoute(routes.asks.readAsk, askView({ answers: fourAnswers().slice(2) }));
    renderAsk();

    expect(
      await screen.findByText("No Meety showed a clear sign. Their answers are below."),
    ).toBeTruthy();
    const unplaced = within(sectionOf("No clear sign in their notes"))
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(unplaced).toEqual(["Sol", "Ana"]);
  });

  it("W6-ASKA-T36 (design section 7): Start a meeting posts the card from the card query and opens the meeting, with no card known the button is replaced by the card line, and a 409 shows its sentence, with fake api replies", async () => {
    stubRoute(routes.asks.readAsk, askView({ answers: fourAnswers() }));
    stubRoute(routes.asks.meetHelper, { status: 201, body: { meetingId: IDS.meeting } });

    renderAsk(CARD_URL);
    await screen.findByRole("heading", { name: HELP_RESULTS_HEADING });
    fireEvent.click(within(itemOf("Mira")).getByRole("button", { name: "Start a meeting" }));

    await waitFor(() => {
      expect(requestsTo(routes.asks.meetHelper)).toHaveLength(1);
    });
    const meetRequest = requestsTo(routes.asks.meetHelper)[0];
    expect(meetRequest?.body).toEqual({ cardId: IDS.card });
    expect(
      meetRequest?.url.endsWith("/api/asks/" + ASK + "/answers/" + ANSWER_IDS.mira + "/meeting"),
    ).toBe(true);
    expect((await screen.findByTestId("location")).textContent).toBe("/meetings/" + IDS.meeting);
    cleanup();
    clearClientState();

    renderAsk();
    await screen.findByRole("heading", { name: HELP_RESULTS_HEADING });
    expect(screen.queryByRole("button", { name: "Start a meeting" })).toBeNull();
    expect(within(itemOf("Mira")).getByText(NO_CARD_LINE)).toBeTruthy();
    cleanup();

    rememberApprovedCard(IDS.card);
    stubRoute(routes.asks.meetHelper, {
      status: 409,
      body: {
        code: "helper_not_meetable",
        message: "This person can no longer be met from these results.",
      },
    });
    renderAsk();
    await screen.findByRole("heading", { name: HELP_RESULTS_HEADING });

    fireEvent.click(within(itemOf("Mira")).getByRole("button", { name: "Start a meeting" }));

    expect(
      await screen.findByText("This person can no longer be met from these results."),
    ).toBeTruthy();
    expect(requestsTo(routes.asks.meetHelper).at(-1)?.body).toEqual({ cardId: IDS.card });
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("W6-ASKA-T37 (design section 7): a react ask shows How Bea would probably react with the answer and its quotes and no meeting button, with fake api replies", async () => {
    stubRoute(
      routes.asks.readAsk,
      askView({
        mode: "react",
        aboutName: "Bea",
        answers: [
          {
            answerId: ANSWER_IDS.mira,
            displayName: "Bea",
            line: null,
            answer: "Bea's persona would probably ask for a backup plan.",
            claims: [BACKED],
            hasSign: true,
            position: null,
            canMeet: false,
          },
        ],
      }),
    );

    renderAsk(CARD_URL);

    expect(
      await screen.findByRole("heading", { name: "How Bea would probably react" }),
    ).toBeTruthy();
    expect(screen.getByText("Bea's persona would probably ask for a backup plan.")).toBeTruthy();
    expect(screen.getAllByText(BACKED.quote, { selector: "blockquote" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Start a meeting" })).toBeNull();
    expect(screen.queryByRole("heading", { name: HELP_RESULTS_HEADING })).toBeNull();
  });

  it("W6-ASKA-T38 (design section 7): a refused ask shows its reason and a failed ask shows This ask could not finish. Try again., with fake api replies", async () => {
    const reason =
      "Meet First never scores or guarantees; ask: would we enjoy a first date, and where would we click?";
    stubRoute(routes.asks.readAsk, askView({ state: "refused", refusedReason: reason }));

    renderAsk();

    expect(within(await screen.findByRole("alert")).getByText(reason)).toBeTruthy();
    cleanup();

    stubRoute(routes.asks.readAsk, askView({ state: "failed" }));
    renderAsk();

    expect(await screen.findByText("This ask could not finish. Try again.")).toBeTruthy();
  });

  it("W7-ASK-T24c: a failed self ask leads back to your profile, with fake api replies", async () => {
    stubRoute(routes.asks.readAsk, askView({ mode: "self", state: "failed", aboutName: "Ana" }));

    renderAsk();

    expect(
      (await screen.findByRole("link", { name: "Back to your profile" })).getAttribute("href"),
    ).toBe(APP_PATHS.me);
  });

  it("W6-ASKA-T39 (design section 7): every control has a label and the page has no overflow at 375 px, with fake api replies", async () => {
    stubRoute(routes.asks.readAsk, askView({ answers: fourAnswers() }));

    renderAsk(CARD_URL);
    await screen.findByRole("heading", { name: HELP_RESULTS_HEADING });

    expect(unlabelledControls(document.body)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
