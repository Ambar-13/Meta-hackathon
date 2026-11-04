import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { CURATED_QUESTIONS } from "@meet-first/contracts";
import { IDS, meetingView, pairView, SERVER_NOW } from "../../testing/fixtures.js";
import { LobbyScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const READY_ROW = {
  id: IDS.meeting,
  state: "ready" as const,
  questionText: CURATED_QUESTIONS[2]?.text ?? "",
  createdAt: SERVER_NOW,
};
const LOBBY_URL = `${APP_PATHS.lobby(IDS.pair)}?card=${IDS.card}`;

// Renders the lobby for the fixture pair with a card.
function renderLobby(): void {
  renderScreen(<LobbyScreen />, { pattern: ROUTE_PATTERNS.lobby, url: LOBBY_URL });
}

// Lets the fake timers run for a number of milliseconds, flushing the pending requests.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("lobby screen", () => {
  it("D54-T1: the lobby polls GET /api/pairs/:id every 5 s, using fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [] }));
    renderLobby();
    await advance(0);
    expect(requestsTo(routes.meetings.readPair)).toHaveLength(1);
    await advance(5000);
    expect(requestsTo(routes.meetings.readPair)).toHaveLength(2);
    await advance(5000);
    expect(requestsTo(routes.meetings.readPair)).toHaveLength(3);
  });

  it("R8.6-T1: the lobby never requests the events route, using fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [READY_ROW] }));
    stubRoute(routes.meetings.readMeeting, meetingView({}));
    stubRoute(routes.meetings.events, { status: 200, body: "" });
    renderLobby();
    await advance(15000);
    expect(requestsTo(routes.meetings.events)).toHaveLength(0);
  });

  it("D53-T1: the lobby waits for the other person to say ready and sends no start request, using fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [READY_ROW] }));
    stubRoute(routes.meetings.readMeeting, [
      meetingView({
        members: [
          { side: "a", displayName: "A", ready: true, connected: true },
          { side: "b", displayName: "B", ready: false, connected: false },
        ],
      }),
      meetingView({
        members: [
          { side: "a", displayName: "A", ready: true, connected: true },
          { side: "b", displayName: "B", ready: true, connected: true },
        ],
      }),
    ]);
    renderLobby();
    await advance(0);
    expect(screen.getByText("Waiting for the other person to say ready.")).toBeTruthy();
    await advance(5000);
    expect(
      screen.getByText("Both of you have said ready. The meeting starts by itself."),
    ).toBeTruthy();
    expect(requestsTo(routes.meetings.start)).toHaveLength(0);
  });

  it("R10.5-T1: the picker offers the 20 curated questions and free text of 5 to 300 characters", async () => {
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [] }));
    stubRoute(routes.meetings.createMeeting, { status: 201, body: { meetingId: IDS.meeting } });
    renderLobby();
    const picker = await screen.findByRole("group", {
      name: "What should your Meetys talk about?",
    });
    expect(picker.querySelectorAll('input[type="radio"]')).toHaveLength(
      CURATED_QUESTIONS.length + 1,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Write your own question" }));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Hm?" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));
    expect(screen.getByText("Write a question of 5 to 300 characters.")).toBeTruthy();
    expect(requestsTo(routes.meetings.createMeeting)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "Should we split work by strengths?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));
    await waitFor(() => {
      expect(requestsTo(routes.meetings.createMeeting)).toHaveLength(1);
    });
    expect(requestsTo(routes.meetings.createMeeting)[0]?.body).toEqual({
      freeText: "Should we split work by strengths?",
      cardId: IDS.card,
    });
  });

  it("R10.5-T7: the curated questions sit in five named groups of four", async () => {
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [] }));
    renderLobby();
    await screen.findByRole("group", { name: "What should your Meetys talk about?" });
    for (const name of [
      "Would you get along?",
      "Could you help each other?",
      "Would you make a deal?",
      "Where would your views split?",
      "Would you get on as a couple?",
    ]) {
      expect(
        screen.getByRole("group", { name }).querySelectorAll('input[type="radio"]'),
      ).toHaveLength(4);
    }
  });

  it("D53-T2: when the meeting starts the lobby opens the meeting page, using fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [READY_ROW] }));
    stubRoute(routes.meetings.readMeeting, [
      meetingView({}),
      meetingView({ state: "running", startedAt: SERVER_NOW, endsAt: "2026-10-27T10:10:00.000Z" }),
    ]);
    renderLobby();
    await advance(0);
    await advance(5000);
    expect(screen.getByTestId("location").textContent).toBe(`/meetings/${IDS.meeting}`);
  });

  it("D54-T2: every control on the lobby has an accessible name at 375 px", async () => {
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [] }));
    renderLobby();
    await screen.findByRole("group", { name: "What should your Meetys talk about?" });
    expect(unlabelledControls(document.body)).toEqual([]);
    cleanup();
    stubRoute(routes.meetings.readPair, pairView({ hasJoiner: true, meetings: [READY_ROW] }));
    stubRoute(routes.meetings.readMeeting, meetingView({}));
    renderLobby();
    await screen.findByText("Waiting for the other person to say ready.");
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
