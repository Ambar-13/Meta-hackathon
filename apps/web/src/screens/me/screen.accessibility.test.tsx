import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CURATED_QUESTIONS, ListedMeetingsView, MyListing, type HomeView } from "@meet-first/contracts";
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

// Two meetings the person's persona was in through Explore.
const ENDED_MEETING = "00000000-0000-4000-8000-000000000521";
const READY_MEETING = "00000000-0000-4000-8000-000000000522";
// GET /api/directory/me for a person with no listing.
const NOT_LISTED: StubInput = { status: 404, body: { code: "not_listed", message: "You are not in the directory." } };
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
  it("W7-WEB-A-T8a: listed, /me shows your profile as others see it with Edit my listing, your own Posts words, the home sections and the links", async () => {
    stubMeReads({ listing: myListing(true) });
    renderMe();
    const head = await header();

    await waitFor(() => {
      expect(requestsTo(routes.social.readProfile)).toHaveLength(1);
    });
    expect(within(head).getByText("Builds hackathon tools")).toBeTruthy();
    expect(within(head).queryByText(/things? shared/)).toBeNull();
    expect(within(head).getByRole("button", { name: "Edit my listing" }).getAttribute("aria-expanded")).toBe("false");
    expect(requestsTo(routes.social.readProfile)[0]?.url).toContain(`/api/directory/${LISTING_IDS.mine}`);
    fireEvent.click(screen.getByRole("tab", { name: "Posts" }));
    expect(screen.getByRole("heading", { name: "Coming soon: your agent posts." })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Your card" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Meetings" })).toBeTruthy();
    const links = within(screen.getByRole("navigation", { name: "More about you" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Your card", `/cards/${IDS.card}`],
      ["Add more chats", "/upload"],
      ["Settings", "/settings"],
    ]);
  });

  it("W7-WEB-A-T8b: not listed, /me shows your name, the line that you are not in Explore, and Join, which sends your card, line and dating switch", async () => {
    stubMeReads({});
    stubRoute(routes.directory.upsertMyListing, myListing(false));
    renderMe();
    const head = await header();
    expect(within(head).getByText(NOT_LISTED_LINE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave Explore" })).toBeNull();

    fireEvent.change(await screen.findByRole("textbox", { name: "Your line in Explore (up to 140 characters)" }), { target: { value: "  Builds hackathon tools  " } });
    fireEvent.click(screen.getByRole("button", { name: "Join Explore" }));

    expect(await screen.findByRole("button", { name: "Edit my listing" })).toBeTruthy();
    expect(requestsTo(routes.directory.upsertMyListing)[0]?.body).toEqual({ cardId: IDS.card, line: "Builds hackathon tools", openToRomance: false });
  });

  it("W7-WEB-A-T8c: an empty line is refused before any request, and with no approved card Join is not offered", async () => {
    stubMeReads({});
    stubRoute(routes.directory.upsertMyListing, myListing(false));
    renderMe();
    fireEvent.click(await screen.findByRole("button", { name: "Join Explore" }));
    expect(await screen.findByText("Write a line of 1 to 140 characters about yourself.")).toBeTruthy();
    expect(requestsTo(routes.directory.upsertMyListing)).toHaveLength(0);
    cleanup();

    stubMeReads({ home: home({ card: { ...APPROVED_CARD, state: "ready" } }) });
    renderMe();
    expect(await screen.findByText("Approve your card first, then come back here to join.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join Explore" })).toBeNull();
  });

  it("W6-DWEB-T33, moved to /me: Edit my listing shows the line and the dating switch, Save sends them, and Leave sends one DELETE and says so", async () => {
    stubMeReads({ listing: myListing(true) });
    stubRoute(routes.directory.upsertMyListing, myListing(false));
    stubRoute(routes.directory.leave, { status: 204, body: null });
    renderMe();
    fireEvent.click(within(await header()).getByRole("button", { name: "Edit my listing" }));
    const section = screen.getByRole("region", { name: "Your listing" });

    expect(within(section).getByRole<HTMLInputElement>("textbox", { name: "Your line in Explore (up to 140 characters)" }).value).toBe("Builds hackathon tools");
    const dating = within(section).getByRole<HTMLInputElement>("checkbox");
    expect(dating.checked).toBe(true);
    fireEvent.click(dating);
    fireEvent.click(within(section).getByRole("button", { name: "Save my listing" }));
    expect(await within(section).findByText("Saved. People in Explore see this now.")).toBeTruthy();
    expect(requestsTo(routes.directory.upsertMyListing)[0]?.body).toEqual({ cardId: IDS.card, line: "Builds hackathon tools", openToRomance: false });

    fireEvent.click(within(section).getByRole("button", { name: "Leave Explore" }));

    expect(await screen.findByText("You left Explore. Meetings already made stay below.")).toBeTruthy();
    expect(requestsTo(routes.directory.leave)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Leave Explore" })).toBeNull();
    expect(screen.getByText(NOT_LISTED_LINE)).toBeTruthy();
  });

  it("W6-DWEB-T35, moved to /me: the meetings your persona was in link to their meeting, and to their brief once ended", async () => {
    const debate = CURATED_QUESTIONS.find((question) => question.id === 13)?.text ?? "";
    const meetings = ListedMeetingsView.parse({
      meetings: [
        { meetingId: ENDED_MEETING, otherDisplayName: "Ravi", questionText: debate, state: "ended", createdAt: SERVER_NOW },
        { meetingId: READY_MEETING, otherDisplayName: "Mira", questionText: "Should we split work by strengths?", state: "ready", createdAt: SERVER_NOW },
      ],
    });
    stubMeReads({ listing: myListing(false), meetings });

    renderMe();

    expect(await screen.findByText(`Ravi: ${debate}`)).toBeTruthy();
    expect(screen.getByText("Mira: Should we split work by strengths?")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open the meeting" }).map((link) => link.getAttribute("href"))).toEqual([`/meetings/${ENDED_MEETING}`, `/meetings/${READY_MEETING}`]);
    expect(screen.getAllByRole("link", { name: "Read the brief" }).map((link) => link.getAttribute("href"))).toEqual([`/meetings/${ENDED_MEETING}/brief`]);
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  it("W6-DWEB-T36, moved to /me: every control on /me has an accessible name at 375 px, with the listing controls open", async () => {
    stubMeReads({ listing: myListing(true) });
    renderMe();
    fireEvent.click(within(await header()).getByRole("button", { name: "Edit my listing" }));
    await screen.findByRole("heading", { name: "Your card" });

    await waitFor(() => {
      expect(unlabelledControls(document.body)).toEqual([]);
    });
    expect(window.innerWidth).toBe(375);
  });
});
