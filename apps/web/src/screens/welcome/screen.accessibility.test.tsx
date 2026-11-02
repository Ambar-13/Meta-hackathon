import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { personCreated, RECOVERY_CODE, TRANSFER_TOKEN, IDS } from "../../testing/fixtures.js";
import { readAllowlist } from "../../app-shell/browser-session.js";
import { WelcomeScreen } from "./screen.js";
import { ClaimScreen } from "./claim-screen.js";

afterEach(() => {
  cleanup();
});

describe("welcome screens", () => {
  it("A5-T1: the recovery code is shown once with a copy action and the save sentence", async () => {
    stubRoute(routes.people.createPerson, { status: 201, body: personCreated() });
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    fireEvent.change(screen.getByLabelText("Your display name"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));
    expect(await screen.findByText(RECOVERY_CODE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
    expect(screen.getByText("Save this code. It is the only way back in if you lose this device.")).toBeTruthy();
    expect(screen.queryByLabelText("Your display name")).toBeNull();
  });

  it("W5-AGE-T2: the start page and its footer no longer say Meet First is for adults or 18 and over (Ambar, 2 Nov 2026)", () => {
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    expect(screen.queryByText(/for adults|18 and over/i)).toBeNull();
  });

  it("R9.5-T5: when the server asks for an access code, the form shows the field, and the next try sends the code", async () => {
    stubRoute(routes.people.createPerson, [
      { status: 403, body: { code: "access_code_needed", message: "Meet First is invite-only for now. Enter the access code you were given." } },
      { status: 201, body: personCreated() },
    ]);
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    expect(screen.queryByLabelText("Access code")).toBeNull();
    fireEvent.change(screen.getByLabelText("Your display name"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));

    const field = await screen.findByLabelText("Access code");
    expect(screen.getByText("Meet First is invite-only for now. Enter the access code you were given.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "judges" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));

    expect(await screen.findByText(RECOVERY_CODE)).toBeTruthy();
    expect(requestsTo(routes.people.createPerson).map((request) => request.body)).toEqual([{ displayName: "A" }, { displayName: "A", accessCode: "judges" }]);
  });

  it("R9.5-T6: a link with ?access= fills the access code, and the sign-up sends it", async () => {
    stubRoute(routes.people.createPerson, { status: 201, body: personCreated() });
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/?access=judges" });
    const field = screen.getByLabelText("Access code");
    expect(field instanceof HTMLInputElement ? field.value : "").toBe("judges");
    fireEvent.change(screen.getByLabelText("Your display name"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));

    expect(await screen.findByText(RECOVERY_CODE)).toBeTruthy();
    expect(requestsTo(routes.people.createPerson).map((request) => request.body)).toEqual([{ displayName: "A", accessCode: "judges" }]);
  });

  it("A5-T2: continuing opens the upload page and the code is gone for good", async () => {
    stubRoute(routes.people.createPerson, { status: 201, body: personCreated() });
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    fireEvent.change(screen.getByLabelText("Your display name"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));
    await screen.findByText(RECOVERY_CODE);
    fireEvent.click(screen.getByRole("button", { name: "I saved it, continue" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/upload");
    expect(document.body.textContent).not.toContain(RECOVERY_CODE);
  });

  it("D17-T2: the allowlist kept for the upload is the display name and the groups", async () => {
    stubRoute(routes.people.createPerson, { status: 201, body: personCreated() });
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    fireEvent.change(screen.getByLabelText("Your display name"), { target: { value: "Priya" } });
    fireEvent.change(screen.getByLabelText("Groups you belong to (optional)"), { target: { value: "robotics club, design team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));
    await screen.findByText(RECOVERY_CODE);
    expect(requestsTo(routes.people.createPerson)[0]?.body).toEqual({ displayName: "Priya", affiliations: ["robotics club", "design team"] });
    expect(readAllowlist()).toEqual(["Priya", "robotics club", "design team"]);
  });

  it("A5-T3: a blank display name shows the name sentence and sends nothing", async () => {
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    fireEvent.change(screen.getByLabelText("Your display name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Create my profile" }));
    expect(await screen.findByText("Use 1 to 80 characters for your display name.")).toBeTruthy();
    expect(requestsTo(routes.people.createPerson)).toHaveLength(0);
  });

  it("A5-T4: a recovery code opens the upload page, and a refused code shows the server's sentence", async () => {
    stubRoute(routes.people.recover, { status: 200, body: { personId: IDS.personA } });
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: RECOVERY_CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with the code" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/upload");
    cleanup();
    stubRoute(routes.people.recover, { status: 404, body: { code: "recovery_code_unknown", message: "This code is unknown or was used already." } });
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: RECOVERY_CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with the code" }));
    expect(await screen.findByText("This code is unknown or was used already.")).toBeTruthy();
  });

  it("R9.2-T1: the claim page posts the token from the fragment once and opens the upload page", async () => {
    stubRoute(routes.people.claim, { status: 200, body: { personId: IDS.personA } });
    renderScreen(<ClaimScreen />, { pattern: ROUTE_PATTERNS.claim, url: `/claim#${TRANSFER_TOKEN}` });
    fireEvent.click(screen.getByRole("button", { name: "Use this link" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/upload");
    expect(requestsTo(routes.people.claim)).toHaveLength(1);
    expect(requestsTo(routes.people.claim)[0]?.body).toEqual({ token: TRANSFER_TOKEN });
  });

  it("R9.2-T2: a claim link without a token says so and offers no button", () => {
    renderScreen(<ClaimScreen />, { pattern: ROUTE_PATTERNS.claim, url: "/claim" });
    expect(screen.getByText("This link is not complete. Make a new one in Settings on your other browser.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use this link" })).toBeNull();
  });

  it("A5-T5: every control on the welcome page has an accessible name at 375 px", () => {
    renderScreen(<WelcomeScreen />, { pattern: ROUTE_PATTERNS.welcome, url: "/" });
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
