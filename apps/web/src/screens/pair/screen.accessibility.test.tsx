import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, INVITE_TOKEN, personCreated } from "../../testing/fixtures.js";
import { PairScreen } from "./screen.js";
import { JoinScreen } from "./join-screen.js";

afterEach(() => {
  cleanup();
});

const INVITE_URL = `http://localhost:3000/join#${INVITE_TOKEN}`;

describe("pair and join screens", () => {
  it("D32-T2: the pair page shows the invite as a QR code and as a link with a copy action", async () => {
    stubRoute(routes.meetings.createPair, {
      status: 201,
      body: { pairId: IDS.pair, inviteUrl: INVITE_URL, expiresAt: "2026-10-28T10:00:00.000Z" },
    });
    renderScreen(<PairScreen />, { pattern: ROUTE_PATTERNS.pair, url: `/pair?card=${IDS.card}` });
    fireEvent.click(screen.getByRole("button", { name: "Make an invite" }));
    const qr = await screen.findByRole("img", { name: "QR code of the invite link" });
    expect(qr.querySelectorAll("path")).toHaveLength(1);
    expect(qr.querySelector("path")?.getAttribute("d")?.startsWith("M")).toBe(true);
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveProperty(
      "value",
      INVITE_URL,
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByText("The invite works once, for 24 hours.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up the meeting" }).getAttribute("href")).toBe(
      `/pairs/${IDS.pair}?card=${IDS.card}`,
    );
  });

  it("D32-T3: the join page posts the token from the fragment once and opens the lobby", async () => {
    stubRoute(routes.meetings.joinPair, { status: 200, body: { pairId: IDS.pair } });
    renderScreen(<JoinScreen />, { pattern: ROUTE_PATTERNS.join, url: `/join#${INVITE_TOKEN}` });
    fireEvent.click(screen.getByRole("button", { name: "Accept the invite" }));
    const again = screen.queryByRole("button", { name: "Accept the invite" });
    if (again !== null) fireEvent.click(again);
    expect((await screen.findByTestId("location")).textContent).toBe(`/pairs/${IDS.pair}`);
    expect(requestsTo(routes.meetings.joinPair)).toHaveLength(1);
    expect(requestsTo(routes.meetings.joinPair)[0]?.body).toEqual({ token: INVITE_TOKEN });
  });

  it("R9.3-T1: a refused join shows the server's sentence and offers no retry", async () => {
    const sentence =
      "This invite was already used, has expired, or is your own. Ask for a new link.";
    stubRoute(routes.meetings.joinPair, {
      status: 409,
      body: { code: "pair_unavailable", message: sentence },
    });
    renderScreen(<JoinScreen />, { pattern: ROUTE_PATTERNS.join, url: `/join#${INVITE_TOKEN}` });
    fireEvent.click(screen.getByRole("button", { name: "Accept the invite" }));
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept the invite" })).toBeNull();
    expect(requestsTo(routes.meetings.joinPair)).toHaveLength(1);
  });

  it("R9.2-T3: the join page points to Settings for moving the profile to Safari", () => {
    renderScreen(<JoinScreen />, { pattern: ROUTE_PATTERNS.join, url: `/join#${INVITE_TOKEN}` });
    const links = screen.getAllByRole("link", { name: "Settings" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(APP_PATHS.settings);
    }
  });

  it("D32-T4: a join without a session asks for a profile and joins right after it is made", async () => {
    stubRoute(routes.meetings.joinPair, [
      {
        status: 401,
        body: { code: "session_missing", message: "Sign in again from the start page." },
      },
      { status: 200, body: { pairId: IDS.pair } },
    ]);
    stubRoute(routes.people.createPerson, { status: 201, body: personCreated() });
    renderScreen(<JoinScreen />, { pattern: ROUTE_PATTERNS.join, url: `/join#${INVITE_TOKEN}` });
    fireEvent.click(screen.getByRole("button", { name: "Accept the invite" }));
    expect(
      await screen.findByText("Create your profile first. The invite is accepted right after."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your display name"), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));
    fireEvent.click(await screen.findByRole("button", { name: "I saved it, continue" }));
    expect((await screen.findByTestId("location")).textContent).toBe(`/pairs/${IDS.pair}`);
    expect(requestsTo(routes.meetings.joinPair)).toHaveLength(2);
    expect(
      requestsTo(routes.meetings.joinPair).every(
        (request) => JSON.stringify(request.body) === JSON.stringify({ token: INVITE_TOKEN }),
      ),
    ).toBe(true);
  });

  it("D32-T5: every control on the pair and join pages has an accessible name at 375 px", async () => {
    stubRoute(routes.meetings.createPair, {
      status: 201,
      body: { pairId: IDS.pair, inviteUrl: INVITE_URL, expiresAt: "2026-10-28T10:00:00.000Z" },
    });
    renderScreen(<PairScreen />, { pattern: ROUTE_PATTERNS.pair, url: `/pair?card=${IDS.card}` });
    fireEvent.click(screen.getByRole("button", { name: "Make an invite" }));
    await screen.findByRole("img", { name: "QR code of the invite link" });
    expect(unlabelledControls(document.body)).toEqual([]);
    cleanup();
    renderScreen(<JoinScreen />, { pattern: ROUTE_PATTERNS.join, url: `/join#${INVITE_TOKEN}` });
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
