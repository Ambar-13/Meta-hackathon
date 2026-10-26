import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { DIRECTORY_SWITCH_COPY, FRIENDS_ASK_SWITCH_COPY, MyListing, ROMANCE_SWITCH_COPY, type CardView } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { cardView, IDS, SERVER_NOW } from "../../testing/fixtures.js";
import { CardScreen } from "./screen.js";

// The person's listing and a second card of theirs.
const LISTING_ID = "00000000-0000-4000-8000-000000000501";
const OTHER_CARD_ID = "00000000-0000-4000-8000-000000000112";
// The labels of the line field and the public items group, as sharing-section.tsx writes them.
const LINE_LABEL = "A line about you for the directory (1 to 140 characters)";
const PUBLIC_LEGEND = "Items people in the directory can see";
// The four public checkboxes of sharingCard(), in card order.
const PUBLIC_NAMES = ["Value: Claim number 1", "Boundary: Claim number 4", "Goal: Claim number 5", "Value: Claim number 6"];
// GET /api/directory/me for a person with no listing.
const NOT_LISTED: StubInput = { status: 404, body: { code: "not_listed", message: "You are not in the directory." } };

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// The approved fixture card with item 2 left out of the card and item 3 unverified, so items 1, 4, 5 and 6 can be public.
function sharingCard(): CardView {
  const view = cardView("approved");
  view.items = view.items.map((item) => {
    if (item.position === 2) return { ...item, approved: false };
    if (item.position === 3) return { ...item, approved: false, verified: false, flagged: true };
    return item;
  });
  return view;
}

// The person's listing on one card, with the line "Builds hackathon tools" and item 1 public.
function listingOn(cardId: string, isOpen: boolean): MyListing {
  return MyListing.parse({
    listingId: LISTING_ID,
    cardId,
    line: "Builds hackathon tools",
    openToRomance: isOpen,
    items: [{ kind: "value", claim: "Claim number 1", quote: "I said this in my own words, number 1" }],
    createdAt: SERVER_NOW,
  });
}

// Stubs the card, the two reads of the Sharing section and the three writes, each once.
function stubSharing(replies: { sharing: StubInput; listing: StubInput; update?: StubInput; upsert?: StubInput; leave?: StubInput }): void {
  stubRoute(routes.cards.readCard, sharingCard());
  stubRoute(routes.directory.readSharing, replies.sharing);
  stubRoute(routes.directory.readMyListing, replies.listing);
  stubRoute(routes.directory.updateSharing, replies.update ?? { friendsCanAsk: false, publicPositions: [] });
  stubRoute(routes.directory.upsertMyListing, replies.upsert ?? listingOn(IDS.card, false));
  stubRoute(routes.directory.leave, replies.leave ?? { status: 204, body: null });
}

// Renders the card page and waits until the Sharing section has loaded.
async function renderSharing(): Promise<void> {
  renderScreen(<CardScreen />, { pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });
  await screen.findByRole("switch", { name: FRIENDS_ASK_SWITCH_COPY });
}

// Whether a switch or a checkbox is ticked.
function isTicked(element: HTMLElement): boolean {
  return (element as HTMLInputElement).checked;
}

describe("card Sharing section, against the MSW route stubs (a fake server)", () => {
  it("W6-DWEB-T7 (design section 7): the Sharing section is absent while the card is not approved, and no sharing request is sent", async () => {
    stubRoute(routes.cards.readCard, cardView("ready"));
    stubRoute(routes.directory.readSharing, { friendsCanAsk: false, publicPositions: [] });
    stubRoute(routes.directory.readMyListing, NOT_LISTED);

    renderScreen(<CardScreen />, { pattern: ROUTE_PATTERNS.card, url: APP_PATHS.card(IDS.card) });
    await screen.findByText("Claim number 1");

    expect(screen.queryByRole("heading", { name: "Sharing" })).toBeNull();
    expect(requestsTo(routes.directory.readSharing)).toHaveLength(0);
    expect(requestsTo(routes.directory.readMyListing)).toHaveLength(0);
  });

  it("W6-DWEB-T8 (design section 7, P2, P3, P8): on an approved card with nothing shared every control starts off, with the three switch texts verbatim", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: NOT_LISTED });

    await renderSharing();

    const romance = screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY });
    const line = screen.getByRole("textbox", { name: LINE_LABEL });
    expect(screen.getByRole("heading", { name: "Sharing" })).toBeTruthy();
    expect(isTicked(screen.getByRole("switch", { name: FRIENDS_ASK_SWITCH_COPY }))).toBe(false);
    expect(isTicked(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }))).toBe(false);
    expect(isTicked(romance)).toBe(false);
    expect(romance).toHaveProperty("disabled", true);
    expect(line).toHaveProperty("value", "");
    expect(line).toHaveProperty("disabled", true);
    for (const name of PUBLIC_NAMES) expect(isTicked(screen.getByRole("checkbox", { name }))).toBe(false);
  });

  it("W6-DWEB-T9 (P1): only approved items whose quote was found get a public checkbox", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: NOT_LISTED });

    await renderSharing();

    const group = screen.getByRole("group", { name: PUBLIC_LEGEND });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(4);
    for (const name of PUBLIC_NAMES) expect(within(group).getByRole("checkbox", { name })).toBeTruthy();
  });

  it("W6-DWEB-T10 (P1, P3): saving the friends switch and two public items sends one sharing PUT with the positions in order and no listing call", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: NOT_LISTED, update: { friendsCanAsk: true, publicPositions: [1, 4] } });
    await renderSharing();

    fireEvent.click(screen.getByRole("switch", { name: FRIENDS_ASK_SWITCH_COPY }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Boundary: Claim number 4" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Value: Claim number 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save sharing" }));

    expect(await screen.findByText("Sharing saved.")).toBeTruthy();
    expect(requestsTo(routes.directory.updateSharing)).toHaveLength(1);
    expect(requestsTo(routes.directory.updateSharing)[0]?.body).toEqual({ friendsCanAsk: true, publicPositions: [1, 4] });
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(0);
    expect(requestsTo(routes.directory.leave)).toHaveLength(0);
  });

  it("W6-DWEB-T11 (P2, P8): turning the directory on sends the sharing PUT, then lists this card with the trimmed line and the dating switch", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: NOT_LISTED, update: { friendsCanAsk: false, publicPositions: [1] }, upsert: listingOn(IDS.card, true) });
    await renderSharing();

    fireEvent.click(screen.getByRole("checkbox", { name: "Value: Claim number 1" }));
    fireEvent.click(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }));
    fireEvent.change(screen.getByRole("textbox", { name: LINE_LABEL }), { target: { value: "  Builds hackathon tools  " } });
    fireEvent.click(screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY }));
    fireEvent.click(screen.getByRole("button", { name: "Save sharing" }));

    expect(await screen.findByText("Sharing saved.")).toBeTruthy();
    expect(requestsTo(routes.directory.updateSharing)[0]?.body).toEqual({ friendsCanAsk: false, publicPositions: [1] });
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(1);
    expect(requestsTo(routes.directory.upsertMyListing)[0]?.body).toEqual({ cardId: IDS.card, line: "Builds hackathon tools", openToRomance: true });
    expect(requestsTo(routes.directory.leave)).toHaveLength(0);
  });

  it("W6-DWEB-T12 (design section 7): a refused sharing PUT shows the server's sentence and sends no listing PUT", async () => {
    const sentence = "Only approved items with a found quote can be public.";
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: NOT_LISTED, update: { status: 400, body: { code: "payload_invalid", message: sentence } } });
    await renderSharing();

    fireEvent.click(screen.getByRole("checkbox", { name: "Value: Claim number 1" }));
    fireEvent.click(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }));
    fireEvent.change(screen.getByRole("textbox", { name: LINE_LABEL }), { target: { value: "Builds hackathon tools" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sharing" }));

    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(requestsTo(routes.directory.updateSharing)).toHaveLength(1);
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(0);
  });

  it("W6-DWEB-T13 (P2): leaving the directory and clearing the items sends the DELETE, then the sharing PUT, and no listing PUT", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [1] }, listing: listingOn(IDS.card, false), update: { friendsCanAsk: false, publicPositions: [] } });
    await renderSharing();
    expect(isTicked(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }))).toBe(true);
    expect(screen.getByRole("textbox", { name: LINE_LABEL })).toHaveProperty("value", "Builds hackathon tools");

    fireEvent.click(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Value: Claim number 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save sharing" }));

    expect(await screen.findByText("Sharing saved.")).toBeTruthy();
    expect(requestsTo(routes.directory.leave)).toHaveLength(1);
    expect(requestsTo(routes.directory.updateSharing)[0]?.body).toEqual({ friendsCanAsk: false, publicPositions: [] });
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(0);
    expect(isTicked(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }))).toBe(false);
  });

  it("W6-DWEB-T14 (P2): a failed DELETE stops the save before the sharing PUT and shows the server's sentence", async () => {
    const sentence = "The server could not finish this. Try again in a minute.";
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [1] }, listing: listingOn(IDS.card, false), leave: { status: 500, body: { code: "internal", message: sentence } } });
    await renderSharing();

    fireEvent.click(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }));
    fireEvent.click(screen.getByRole("button", { name: "Save sharing" }));

    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(requestsTo(routes.directory.leave)).toHaveLength(1);
    expect(requestsTo(routes.directory.updateSharing)).toHaveLength(0);
  });

  it("W6-DWEB-T15 (P8): turning the directory switch off turns the dating switch off and disables it; turning it on again leaves it off and usable", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [1] }, listing: listingOn(IDS.card, true) });
    await renderSharing();
    expect(isTicked(screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY }))).toBe(true);
    expect(screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }));

    expect(isTicked(screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY }))).toBe(false);
    expect(screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }));
    expect(isTicked(screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY }))).toBe(false);
    expect(screen.getByRole("switch", { name: ROMANCE_SWITCH_COPY })).toHaveProperty("disabled", false);
  });

  it("W6-DWEB-T16 (P2): a listing on another card shows the note, starts with the directory switch off, and a save with it off sends no DELETE", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: listingOn(OTHER_CARD_ID, false), update: { friendsCanAsk: true, publicPositions: [] } });
    await renderSharing();
    expect(screen.getByText("Your persona is listed from another card. Turning the directory switch on here lists this card instead.")).toBeTruthy();
    expect(isTicked(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }))).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: FRIENDS_ASK_SWITCH_COPY }));
    fireEvent.click(screen.getByRole("button", { name: "Save sharing" }));

    expect(await screen.findByText("Sharing saved.")).toBeTruthy();
    expect(requestsTo(routes.directory.updateSharing)[0]?.body).toEqual({ friendsCanAsk: true, publicPositions: [] });
    expect(requestsTo(routes.directory.leave)).toHaveLength(0);
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(0);
  });

  it("W6-DWEB-T17 (P1, P2): a save with the directory on and no public item says so and sends nothing", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: NOT_LISTED });
    await renderSharing();

    fireEvent.click(screen.getByRole("switch", { name: DIRECTORY_SWITCH_COPY }));
    fireEvent.change(screen.getByRole("textbox", { name: LINE_LABEL }), { target: { value: "Builds hackathon tools" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sharing" }));

    expect(await screen.findByText("Mark at least one item public to list your persona.")).toBeTruthy();
    expect(requestsTo(routes.directory.updateSharing)).toHaveLength(0);
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(0);
    expect(requestsTo(routes.directory.leave)).toHaveLength(0);
  });

  it("W6-DWEB-T18 (design section 7): the Sharing section links to the directory with this card in the address", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [] }, listing: NOT_LISTED });

    await renderSharing();

    expect(screen.getByRole("link", { name: "Open the directory" }).getAttribute("href")).toBe(`/directory?card=${IDS.card}`);
  });

  it("W6-DWEB-T19 (design section 7): every control of the approved card page with its Sharing section has an accessible name at 375 px", async () => {
    stubSharing({ sharing: { friendsCanAsk: false, publicPositions: [1] }, listing: listingOn(IDS.card, false) });

    await renderSharing();

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
