import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SummaryPointView, SummaryView } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { SERVER_NOW } from "../../testing/fixtures.js";
import { SummarySection, useSummary } from "./index.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// Two points in the copy prompt's format, after the opening line a person's AI tends to write.
const PASTED = [
  "Here is your summary:",
  "",
  "Kind: view",
  "Topic: Rentably",
  "Point: Believes Rentably was never a bad idea.",
  "Strength: strong",
  "Quote: rentably was never a bad idea, the timing was just early",
  "",
  "Kind: habit",
  "Topic: Mornings",
  "Point: Writes for an hour before checking messages.",
  "Strength: mild",
].join("\n");
// GET /api/people/me/summary for a person with no summary.
const NO_SUMMARY = { status: 404, body: { code: "not_found", message: "This no longer exists or is not yours." } };

// A summary as GET /api/people/me/summary reads it.
function savedView(overrides: Partial<SummaryView> = {}): SummaryView {
  return { state: "ready", points: [], friendsCanAsk: false, updatedAt: SERVER_NOW, ...overrides };
}

// One checked point, its quote found in the person's chats or not.
function checkedPoint(point: string, isFound: boolean): SummaryPointView {
  const found = { quote: "rentably was never a bad idea", turnIndex: 3, turnId: "00000000-0000-4000-8000-000000000701" };
  return { kind: "view", topic: "Rentably", point, strength: "strong", quotes: ["rentably was never a bad idea"], found: isFound ? found : null };
}

// The section with its own summary hook, as a page holds it.
const Section = (props: { hasChats: boolean | null }): ReactElement => {
  const summary = useSummary();
  return <SummarySection hasChats={props.hasChats} summary={summary} />;
};

// Renders the section on /me.
function renderSection(hasChats: boolean | null = true): void {
  renderScreen(<Section hasChats={hasChats} />, { pattern: ROUTE_PATTERNS.me, url: APP_PATHS.me });
}

describe("your AI's summary, against the MSW route stubs (a fake server)", () => {
  it("W7-SUMMARY-UI-T1: Copy the prompt puts the prompt text on the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    stubRoute(routes.people.readSummary, NO_SUMMARY);
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Copy the prompt" }));

    expect(await screen.findByText("Copied. Paste it into ChatGPT or Claude.")).toBeTruthy();
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied.startsWith("# Write my Meety summary")).toBe(true);
    expect(copied).not.toContain("<version>");
    expect(copied).toContain("I can only see this conversation, so I can't summarise you.");
  });

  it("W7-SUMMARY-UI-T2: pasted text shows its points, Remove takes one out, and Save sends the rest with the switch", async () => {
    stubRoute(routes.people.readSummary, [NO_SUMMARY, savedView({ state: "checking", friendsCanAsk: true })]);
    stubRoute(routes.people.saveSummary, { status: 202, body: savedView({ state: "checking", friendsCanAsk: true }) });
    renderSection();

    fireEvent.change(await screen.findByRole("textbox", { name: "Your AI's answer" }), { target: { value: PASTED } });
    const list = screen.getByRole("list", { name: "2 points to save" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(within(list).getByRole("button", { name: "Remove this point: Believes Rentably was never a bad idea." }));
    expect(within(screen.getByRole("list", { name: "1 point to save" })).getAllByRole("listitem")).toHaveLength(1);
    const toggle = screen.getByRole("switch", { name: "Friends can ask my Meety" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(unlabelledControls(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save summary" }));

    expect(await screen.findByText("Checking your summary against your chats.")).toBeTruthy();
    expect(requestsTo(routes.people.saveSummary).map((request) => request.body)).toEqual([
      { text: "Kind: habit\nTopic: Mornings\nPoint: Writes for an hour before checking messages.\nStrength: mild", friendsCanAsk: true },
    ]);
  });

  it("W7-SUMMARY-UI-T3: text with no points says so and keeps Save off", async () => {
    stubRoute(routes.people.readSummary, NO_SUMMARY);
    renderSection();

    fireEvent.change(await screen.findByRole("textbox", { name: "Your AI's answer" }), { target: { value: "I am a builder who likes quiet mornings." } });

    expect(screen.getByText("No points found in this text. Paste the whole answer, from its first Kind line to the end.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save summary" })).toHaveProperty("disabled", true);
    expect(requestsTo(routes.people.saveSummary)).toHaveLength(0);
  });

  it("W7-SUMMARY-UI-T5: a ready summary says how many points were found in the chats", async () => {
    stubRoute(routes.people.readSummary, savedView({ points: [checkedPoint("One.", true), checkedPoint("Two.", false), checkedPoint("Three.", true)] }));
    renderSection();

    expect(await screen.findByText("2 of 3 points found in your chats.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Your AI's answer" })).toBeNull();
  });

  it("W7-SUMMARY-UI-T7: Delete summary removes it, and the paste box comes back", async () => {
    stubRoute(routes.people.readSummary, [savedView({ points: [checkedPoint("One.", true)] }), NO_SUMMARY]);
    stubRoute(routes.people.deleteSummary, { status: 204, body: null });
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Delete summary" }));

    expect(await screen.findByRole("textbox", { name: "Your AI's answer" })).toBeTruthy();
    expect(requestsTo(routes.people.deleteSummary)).toHaveLength(1);
  });
});
