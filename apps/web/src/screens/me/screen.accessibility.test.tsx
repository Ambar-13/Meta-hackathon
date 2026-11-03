import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CURATED_QUESTIONS, ListedMeetingsView, MyListing, type HomeMeetingRow, type HomeView } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, LISTING_IDS, profileView, SERVER_NOW } from "../../testing/fixtures.js";
import { MeScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// Two meetings of the person's, the first one someone started with them in Explore.
const ENDED_MEETING = "00000000-0000-4000-8000-000000000521";
const READY_MEETING = "00000000-0000-4000-8000-000000000522";
// GET /api/directory/me for a person with no listing.
const NOT_LISTED: StubInput = { status: 404, body: { code: "not_listed", message: "You are not in Explore yet." } };
// The line shown to a person who is not in Explore.
const NOT_LISTED_LINE = "You are not in Explore yet. Join so friends can find you.";
// The person's approved card on home.
const APPROVED_CARD = { id: IDS.card, state: "approved" as const, itemCount: 4, items: [{ kind: "habit" as const, claim: "Plans before building", quote: "I can't start until I know what done looks like." }] };

// A home view for Ana with an approved card.
function home(overrides: Partial<HomeView> = {}): HomeView {
  return { displayName: "Ana", source: { id: IDS.source, namesPassDone: true, namesReviewed: true }, card: APPROVED_CARD, meetings: [], pairs: [], serverNow: SERVER_NOW, ...overrides };
}

// The person's own listing on the fixture card, with item 1 public.
function myListing(isOpen: boolean): MyListing {
  return MyListing.parse({
    listingId: LISTING_IDS.mine,
    cardId: IDS.card,
    line: "Builds hackathon tools",
    openToRomance: isOpen,
    items: [{ kind: "value", claim: "Claim number 1", quote: "I said this in my own words, number 1" }],
    createdAt: SERVER_NOW,
  });
}

// The person's listing as Explore shows it to them: friendship self.
const MY_PROFILE = profileView({ listingId: LISTING_IDS.mine, displayName: "Ana", line: "Builds hackathon tools", items: [{ kind: "value", claim: "Claim number 1", quote: "I said this in my own words, number 1" }], friendship: "self" });

// Stubs the reads of /me. The profile route is stubbed first, so the more exact /api/directory/me stub answers its own path.
function stubMeReads(replies: { listing?: StubInput; meetings?: StubInput; home?: StubInput; profile?: StubInput }): void {
  stubRoute(routes.social.readProfile, replies.profile ?? MY_PROFILE);
  stubRoute(routes.directory.readMyListing, replies.listing ?? NOT_LISTED);
  stubRoute(routes.directory.listedMeetings, replies.meetings ?? { meetings: [] });
  stubRoute(routes.people.readHome, replies.home ?? home());
}

// Renders /me.
function renderMe(): void {
  renderScreen(<MeScreen />, { pattern: ROUTE_PATTERNS.me, url: APP_PATHS.me });
}

// The profile header, where the name and the buttons sit.
async function header(): Promise<HTMLElement> {
  const head = (await screen.findByRole("heading", { level: 1, name: "Ana" })).closest("header");
  if (head === null) throw new Error("the name is not inside the profile header");
  return head;
}

describe("/me, against the MSW route stubs (a fake server)", () => {
  it("W7-WEB-A-T8a: listed, /me shows your profile as others see it with Edit profile and Your card, the next step above the tabs, your own Posts words, and Add more chats under About", async () => {
    stubMeReads({ listing: myListing(true) });
    renderMe();
    const head = await header();

    await waitFor(() => {
      expect(requestsTo(routes.social.readProfile)).toHaveLength(1);
    });
    expect(within(head).getByText("Builds hackathon tools")).toBeTruthy();
    expect(within(head).queryByText(/things? shared/)).toBeNull();
    expect(within(head).getByRole("button", { name: "Edit profile" }).getAttribute("aria-expanded")).toBe("false");
    expect(requestsTo(routes.social.readProfile)[0]?.url).toContain(`/api/directory/${LISTING_IDS.mine}`);
    expect(within(head).getByRole("link", { name: "Your card" }).getAttribute("href")).toBe(`/cards/${IDS.card}`);
    const next = await screen.findByRole("heading", { level: 2, name: "See how you'd get on with someone." });
    expect(next.compareDocumentPosition(screen.getByRole("tablist", { name: "Profile" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find people" }).getAttribute("href")).toBe(APP_PATHS.search);
    expect(within(screen.getByRole("tabpanel", { name: "About" })).getByRole("link", { name: "Add more chats" }).getAttribute("href")).toBe("/upload");
    fireEvent.click(screen.getByRole("tab", { name: "Posts" }));
    expect(screen.getByRole("heading", { name: "Coming soon: your Meety posts." })).toBeTruthy();
  });

  it("W7-ME-T1: nothing on /me shows twice: one link to your card, no box of your card, no list of links at the foot, and no persona", async () => {
    stubMeReads({ listing: myListing(true) });
    renderMe();
    await screen.findByText("Your next step");

    expect(screen.getAllByRole("link", { name: "Your card" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Your card" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "More about you" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["About", "Posts", "Meetings"]);
    expect(document.body.textContent).not.toMatch(/persona|directory/i);
  });

  it("W7-ME-T2: with no notes yet the next step is Add your notes, and About offers no second way to add chats", async () => {
    stubMeReads({ home: home({ source: null, card: null }) });
    renderMe();

    expect(await screen.findByRole("heading", { level: 2, name: "Add your notes." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add your notes" }).getAttribute("href")).toBe("/upload");
    expect(screen.queryByRole("link", { name: "Add more chats" })).toBeNull();
  });

  it("W7-WEB-A-T8b: not listed, /me shows your name, the line that you are not in Explore, and Join, which sends your card, line and dating switch", async () => {
    stubMeReads({});
    stubRoute(routes.directory.upsertMyListing, myListing(false));
    renderMe();
    const head = await header();
    expect(within(head).getByText(NOT_LISTED_LINE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave Explore" })).toBeNull();

    fireEvent.change(await screen.findByRole("textbox", { name: "Your line in Explore" }), { target: { value: "  Builds hackathon tools  " } });
    fireEvent.click(screen.getByRole("button", { name: "Join Explore" }));

    expect(await screen.findByRole("button", { name: "Edit profile" })).toBeTruthy();
    expect(requestsTo(routes.directory.upsertMyListing)[0]?.body).toEqual({ cardId: IDS.card, line: "Builds hackathon tools", openToRomance: false });
  });

  it("W7-WEB-A-T8c: an empty line is refused before any request, and with no approved card Join is not offered and the next step says to approve it", async () => {
    stubMeReads({});
    stubRoute(routes.directory.upsertMyListing, myListing(false));
    renderMe();
    fireEvent.click(await screen.findByRole("button", { name: "Join Explore" }));
    expect(await screen.findByText("Write a line of 1 to 140 characters about yourself.")).toBeTruthy();
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(0);
    cleanup();

    stubMeReads({ home: home({ card: { ...APPROVED_CARD, state: "ready" } }) });
    renderMe();
    expect(await screen.findByRole("heading", { level: 2, name: "Approve your card." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review my card" }).getAttribute("href")).toBe(`/cards/${IDS.card}`);
    expect(screen.queryByRole("button", { name: "Join Explore" })).toBeNull();
  });

  it("W6-DWEB-T33, moved to /me: Edit profile shows the line and the dating switch, Save sends them, and Leave sends one DELETE and says so", async () => {
    stubMeReads({ listing: myListing(true) });
    stubRoute(routes.directory.upsertMyListing, myListing(false));
    stubRoute(routes.directory.leave, { status: 204, body: null });
    renderMe();
    fireEvent.click(within(await header()).getByRole("button", { name: "Edit profile" }));
    const section = screen.getByRole("region", { name: "Your listing" });

    expect(within(section).getByRole<HTMLInputElement>("textbox", { name: "Your line in Explore" }).value).toBe("Builds hackathon tools");
    const dating = within(section).getByRole<HTMLInputElement>("checkbox");
    expect(dating.checked).toBe(true);
    fireEvent.click(dating);
    fireEvent.click(within(section).getByRole("button", { name: "Save my listing" }));
    expect(await within(section).findByText("Saved. People in Explore see this now.")).toBeTruthy();
    expect(requestsTo(routes.directory.upsertMyListing)[0]?.body).toEqual({ cardId: IDS.card, line: "Builds hackathon tools", openToRomance: false });

    fireEvent.click(within(section).getByRole("button", { name: "Leave Explore" }));

    expect(await screen.findByText("You left Explore. Your meetings stay in the Meetings tab.")).toBeTruthy();
    expect(requestsTo(routes.directory.leave)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Leave Explore" })).toBeNull();
    expect(screen.getByText(NOT_LISTED_LINE)).toBeTruthy();
  });

  it("W6-DWEB-T35, moved to /me: the Meetings tab lists each meeting once, to its brief once ready or else to the meeting, marks the one someone started in Explore, then the open invites", async () => {
    const debate = CURATED_QUESTIONS.find((question) => question.id === 13)?.text ?? "";
    const rows: HomeMeetingRow[] = [
      { id: ENDED_MEETING, otherDisplayName: "Ravi", questionText: debate, questionKind: "debate", state: "ended", isBriefReady: true, createdAt: SERVER_NOW },
      { id: READY_MEETING, otherDisplayName: "Mira", questionText: "Should we split work by strengths?", questionKind: "decision", state: "ready", isBriefReady: false, createdAt: SERVER_NOW },
    ];
    const listed = ListedMeetingsView.parse({ meetings: [{ meetingId: ENDED_MEETING, otherDisplayName: "Ravi", questionText: debate, state: "ended", createdAt: SERVER_NOW }] });
    const pairs = [{ id: IDS.pair, otherDisplayName: null, createdAt: SERVER_NOW, expiresAt: SERVER_NOW }];
    stubMeReads({ listing: myListing(false), meetings: listed, home: home({ meetings: rows, pairs }) });
    renderMe();

    fireEvent.click(await screen.findByRole("tab", { name: "Meetings" }));
    const panel = screen.getByRole("tabpanel", { name: "Meetings" });
    await within(panel).findByText(`With Ravi: ${debate}`);

    const links = within(panel).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/meetings/${ENDED_MEETING}/brief`, `/meetings/${READY_MEETING}`, APP_PATHS.lobby(IDS.pair)]);
    const [ravi, mira, invite] = links as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(ravi).getByText("Brief ready · Today · From Explore")).toBeTruthy();
    expect(within(mira).getByText("With Mira: Should we split work by strengths?")).toBeTruthy();
    expect(within(mira).getByText("Waiting to start · Today")).toBeTruthy();
    expect(within(invite).getByText("Waiting for someone to join")).toBeTruthy();
    expect(within(invite).getByText("Open until Today")).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Open invites" })).toBeTruthy();
  });

  it("W6-DWEB-T36, moved to /me: every control on /me has an accessible name at 375 px, with the listing controls open", async () => {
    stubMeReads({ listing: myListing(true) });
    renderMe();
    fireEvent.click(within(await header()).getByRole("button", { name: "Edit profile" }));
    await screen.findByText("Your next step");

    await waitFor(() => {
      expect(unlabelledControls(document.body)).toEqual([]);
    });
    expect(window.innerWidth).toBe(375);
  });
});
