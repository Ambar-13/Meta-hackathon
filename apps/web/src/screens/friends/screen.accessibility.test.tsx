import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AsksView, FriendsView, type AboutMeAnswer, type AnswerClaim, type Friend } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { SERVER_NOW } from "../../testing/fixtures.js";
import { FriendsScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// The fixed ids of this file.
const ASK = "00000000-0000-4000-8000-000000000501";
const PAIRS = { bea: "00000000-0000-4000-8000-000000000141", cal: "00000000-0000-4000-8000-000000000142" } as const;
const COPY_IDS = { react: "00000000-0000-4000-8000-000000000521", help: "00000000-0000-4000-8000-000000000522" } as const;
// A backed claim and a claim whose quote was not found.
const BACKED: AnswerClaim = { text: "Says yes, then plans", quote: "I say yes first and plan the details after.", verified: true, supported: true };
const UNVERIFIED: AnswerClaim = { text: "Reads the logs first", quote: "I read the logs first.", verified: false, supported: null };
// Bea turned friend asks on; Cal did not.
const BEA: Friend = { pairId: PAIRS.bea, displayName: "Bea", canAsk: true };
const CAL: Friend = { pairId: PAIRS.cal, displayName: "Cal", canAsk: false };
// The two copies of the caller's persona's answers, newest first as the server sends them.
const REACT_COPY: AboutMeAnswer = { answerId: COPY_IDS.react, mode: "react", text: "Being asked to lead the demo at the last minute.", askerName: "Ola", answer: "My person would probably say yes, then ask for notes.", claims: [BACKED], createdAt: SERVER_NOW };
const HELP_COPY: AboutMeAnswer = { answerId: COPY_IDS.help, mode: "help", text: "Our deploys fail at night and nobody knows why.", askerName: "Pim", answer: "My person would probably read the logs first.", claims: [UNVERIFIED], createdAt: SERVER_NOW };
// The ask text the tests send to Bea.
const REACT_TEXT = "Being asked to lead the demo at the last minute.";

// Stubs the two reads of the page with these friends and these copies.
function stubReads(input: { friends: Friend[]; aboutMe: AboutMeAnswer[] }): void {
  stubRoute(routes.directory.friends, FriendsView.parse({ friends: input.friends }));
  stubRoute(routes.asks.listAsks, AsksView.parse({ asked: [], aboutMe: input.aboutMe }));
}

// Renders the friends page.
function renderFriends(): void {
  renderScreen(<FriendsScreen />, { pattern: ROUTE_PATTERNS.friends, url: APP_PATHS.friends });
}

// The row of the friend with this display name.
async function friendRow(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name, { selector: "strong" })).closest("li");
  if (row === null) throw new Error(`no friend named ${name}`);
  return row;
}

// The section that starts with a heading of this name.
function sectionOf(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  if (section === null) throw new Error(`no section titled ${name}`);
  return section;
}

describe("friends screen", () => {
  it("W6-ASKA-T40 (design section 7, P3): a friend who turned on friend asks gets Ask how they would react, the others the line that they have not, and no friend shows the nobody line, with fake api replies", async () => {
    stubReads({ friends: [BEA, CAL], aboutMe: [] });

    renderFriends();

    expect(within(await friendRow("Bea")).getAllByRole("button", { name: "Ask how they would react" })).toHaveLength(1);
    const calRow = await friendRow("Cal");
    expect(within(calRow).getByText("Cal has not turned on friend asks.")).toBeTruthy();
    expect(within(calRow).queryAllByRole("button")).toHaveLength(0);
    cleanup();

    stubReads({ friends: [], aboutMe: [] });
    renderFriends();
    expect(await screen.findByText("Nobody yet. People you pair with by invite link show up here.")).toBeTruthy();
  });

  it("W6-ASKA-T41 (design section 7): asking a friend opens the box, a question under 5 characters shows the length line and sends nothing, and a valid question posts mode react with the pair and opens the answers page, with fake api replies", async () => {
    stubReads({ friends: [BEA, CAL], aboutMe: [] });
    stubRoute(routes.asks.createAsk, { status: 201, body: { askId: ASK } });
    renderFriends();

    fireEvent.click(within(await friendRow("Bea")).getByRole("button", { name: "Ask how they would react" }));
    expect(screen.getByLabelText("What should Bea react to? (5 to 300 characters)").tagName).toBe("TEXTAREA");

    fireEvent.change(screen.getByLabelText("What should Bea react to? (5 to 300 characters)"), { target: { value: "Hm" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the ask" }));
    expect(screen.getByText("Write a question of 5 to 300 characters.")).toBeTruthy();
    expect(requestsTo(routes.asks.createAsk)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("What should Bea react to? (5 to 300 characters)"), { target: { value: "  " + REACT_TEXT + "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send the ask" }));

    await waitFor(() => {
      expect(requestsTo(routes.asks.createAsk)).toHaveLength(1);
    });
    expect(requestsTo(routes.asks.createAsk)[0]?.body).toEqual({ mode: "react", pairId: PAIRS.bea, text: REACT_TEXT });
    expect((await screen.findByTestId("location")).textContent).toBe("/asks/" + ASK);
  });

  it("W6-ASKA-T42 (design section 6): a 409 friend_asks_off reply shows its sentence inside the friend's row and the page stays, with fake api replies", async () => {
    stubReads({ friends: [BEA], aboutMe: [] });
    stubRoute(routes.asks.createAsk, { status: 409, body: { code: "friend_asks_off", message: "Bea has not turned on friend asks." } });
    renderFriends();

    fireEvent.click(within(await friendRow("Bea")).getByRole("button", { name: "Ask how they would react" }));
    fireEvent.change(screen.getByLabelText("What should Bea react to? (5 to 300 characters)"), { target: { value: REACT_TEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Send the ask" }));

    expect(await within(await friendRow("Bea")).findByText("Bea has not turned on friend asks.")).toBeTruthy();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("W6-ASKA-T43 (design section 7, P4): Answers your persona gave lists the copies in the server's order with who asked, what, the answer and its marks, and no copy shows its line, with fake api replies", async () => {
    stubReads({ friends: [BEA], aboutMe: [REACT_COPY, HELP_COPY] });

    renderFriends();

    expect(await screen.findByText("Ola asked how you would probably react to: Being asked to lead the demo at the last minute.")).toBeTruthy();
    const copies = Array.from(sectionOf("Answers your persona gave").querySelector("ul")?.children ?? []);
    expect(copies).toHaveLength(2);
    const first = within(copies[0] as HTMLElement);
    expect(first.getByText("Ola asked how you would probably react to: Being asked to lead the demo at the last minute.")).toBeTruthy();
    expect(first.getByText("Your persona's answer")).toBeTruthy();
    expect(first.getByText("My person would probably say yes, then ask for notes.")).toBeTruthy();
    expect(first.getAllByText(BACKED.quote, { selector: "blockquote" })).toHaveLength(1);
    expect(first.queryAllByRole("note")).toHaveLength(0);
    const second = within(copies[1] as HTMLElement);
    expect(second.getByText("Pim asked the directory for help: Our deploys fail at night and nobody knows why.")).toBeTruthy();
    expect(second.getAllByRole("note").map((note) => note.textContent)).toEqual(["no receipt"]);
    cleanup();

    stubReads({ friends: [BEA], aboutMe: [] });
    renderFriends();
    expect(await screen.findByText("Your persona has not answered anyone yet.")).toBeTruthy();
  });

  it("W6-ASKA-T44 (design section 7): the links to Find help and Directory sit in the page's own nav, every control is labelled, and there is no overflow at 375 px, with fake api replies", async () => {
    stubReads({ friends: [BEA, CAL], aboutMe: [REACT_COPY] });

    renderFriends();
    await friendRow("Bea");

    const nav = screen.getByRole("navigation", { name: "Find more people" });
    expect(within(nav).getByRole("link", { name: "Find help" }).getAttribute("href")).toBe("/help");
    expect(within(nav).getByRole("link", { name: "Directory" }).getAttribute("href")).toBe("/directory");
    expect(unlabelledControls(document.body)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
