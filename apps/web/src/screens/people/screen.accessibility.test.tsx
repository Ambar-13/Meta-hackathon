import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CURATED_QUESTIONS, type ProfileView } from "@meet-first/contracts";
import { clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, LISTING_IDS, profileView } from "../../testing/fixtures.js";
import { PersonScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// The pair that makes the viewer and Mira friends.
const PAIR = "00000000-0000-4000-8000-000000000141";
// The own-profile words of the Posts tab, word for word (wave 7).
const OWN_POSTS = {
  heading: "Coming soon: your agent posts.",
  body: "Your agent will draft posts from your chats or on a topic you give, and nothing goes up until you say yes. You will also be able to repost your Instagram posts here.",
} as const;

// Renders the profile of one listing with these replies for GET /api/directory/:id; search is added to the address.
function renderProfile(replies: StubInput | StubInput[], options: { listingId?: string; search?: string } = {}): void {
  stubRoute(routes.social.readProfile, replies);
  const listingId = options.listingId ?? LISTING_IDS.mira;
  renderScreen(<PersonScreen />, { pattern: ROUTE_PATTERNS.person, url: `/people/${listingId}${options.search ?? ""}` });
}

// Mira as a friend, with friend asks on or off.
function friendMira(canAsk: boolean, overrides: Partial<ProfileView> = {}): ProfileView {
  return profileView({ friendship: "friends", pairId: PAIR, canAsk, ...overrides });
}

// The profile header, where the buttons sit.
async function header(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 1, name: "Mira" });
  const head = heading.closest("header");
  if (head === null) throw new Error("the name is not inside the profile header");
  return head;
}

describe("profile page, against the MSW route stubs (a fake server)", () => {
  it("W7-WEB-A-T5a: with no friendship, Add friend posts the listing id, then the profile reads again and shows Requested", async () => {
    renderProfile([profileView({}), profileView({ friendship: "requested", requestId: LISTING_IDS.request })]);
    stubRoute(routes.social.sendFriendRequest, { status: 201, body: { requestId: LISTING_IDS.request } });

    const head = await header();
    expect(within(head).getByText("3 things shared")).toBeTruthy();
    expect(within(head).getByText("Mira builds small tools")).toBeTruthy();
    fireEvent.click(within(head).getByRole("button", { name: "Add friend" }));

    const requested = await within(head).findByRole("button", { name: "Requested" });
    expect(requested.hasAttribute("disabled")).toBe(true);
    expect(within(head).getByText("Waiting for Mira to answer.")).toBeTruthy();
    expect(requestsTo(routes.social.sendFriendRequest)[0]?.body).toEqual({ listingId: LISTING_IDS.mira });
    expect(requestsTo(routes.social.readProfile)).toHaveLength(2);
  });

  it("W7-WEB-A-T5b: a refused Add friend shows the api's own sentence", async () => {
    const sentence = "You have sent as many friend requests as you can today. Try again tomorrow.";
    renderProfile(profileView({}));
    stubRoute(routes.social.sendFriendRequest, { status: 429, body: { code: "friend_request_daily_cap", message: sentence } });

    fireEvent.click(within(await header()).getByRole("button", { name: "Add friend" }));

    expect((await screen.findByRole("alert")).textContent).toContain(sentence);
  });

  it("W7-WEB-A-T5c: an incoming request offers Accept and Decline, and each posts to its route with the request id", async () => {
    const incoming = profileView({ friendship: "incoming", requestId: LISTING_IDS.request });
    renderProfile([incoming, friendMira(true)]);
    stubRoute(routes.social.acceptFriendRequest, { pairId: PAIR });
    stubRoute(routes.social.declineFriendRequest, { status: 204, body: null });

    fireEvent.click(within(await header()).getByRole("button", { name: "Accept" }));
    expect(await within(await header()).findByText("Friends")).toBeTruthy();
    expect(requestsTo(routes.social.acceptFriendRequest)[0]?.url).toContain(`/api/friend-requests/${LISTING_IDS.request}/accept`);
    cleanup();

    renderProfile([incoming, profileView({})]);
    fireEvent.click(within(await header()).getByRole("button", { name: "Decline" }));
    expect(await within(await header()).findByRole("button", { name: "Add friend" })).toBeTruthy();
    expect(requestsTo(routes.social.declineFriendRequest)[0]?.url).toContain(`/api/friend-requests/${LISTING_IDS.request}/decline`);
  });

  it("W7-WEB-A-T5d: a friend shows the Friends chip, Ask their agent linking to the chat with a draft, and Meet their agent; with asks off, the line instead", async () => {
    renderProfile(friendMira(true), { search: `?card=${IDS.card}` });
    const head = await header();

    expect(within(head).getByText("Friends")).toBeTruthy();
    expect(within(head).getByRole("link", { name: "Ask their agent" }).getAttribute("href")).toBe("/home?draft=How%20would%20Mira%20react%20to%20");
    expect(within(head).getByRole("button", { name: "Meet their agent" })).toBeTruthy();
    cleanup();

    renderProfile(friendMira(false), { search: `?card=${IDS.card}` });
    const offHead = await header();
    expect(within(offHead).queryByRole("link", { name: "Ask their agent" })).toBeNull();
    expect(within(offHead).getByText("Mira has not turned on friend asks yet.")).toBeTruthy();
    expect(within(offHead).getByRole("button", { name: "Meet their agent" })).toBeTruthy();
  });

  it("W7-WEB-A-T5e: your own profile shows Edit my listing, a link to /me, and no friend buttons", async () => {
    renderProfile(profileView({ friendship: "self" }));
    const head = await header();

    expect(within(head).getByRole("link", { name: "Edit my listing" }).getAttribute("href")).toBe("/me");
    expect(within(head).queryAllByRole("button")).toHaveLength(0);
  });

  it("W7-WEB-A-T6: the Posts tab shows the other-person words on someone else's profile and the own words on yours, and the arrow keys move between the tabs", async () => {
    renderProfile(profileView({}));
    await header();
    const about = screen.getByRole("tab", { name: "About" });
    expect(about.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "About" }).textContent).toContain("Mira starts work early");

    fireEvent.keyDown(about, { key: "ArrowRight" });
    const posts = screen.getByRole("tab", { name: "Posts" });
    expect(posts.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(posts);
    const panel = screen.getByRole("tabpanel", { name: "Posts" });
    expect(within(panel).getByRole("heading", { name: "Coming soon: posts by Mira's agent." })).toBeTruthy();
    expect(within(panel).getByText("Mira's agent will draft posts from Mira's chats or on a topic Mira gives, and nothing goes up until Mira says yes.")).toBeTruthy();
    fireEvent.keyDown(posts, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "About" }).getAttribute("aria-selected")).toBe("true");
    cleanup();

    renderProfile(profileView({ friendship: "self" }));
    await header();
    fireEvent.click(screen.getByRole("tab", { name: "Posts" }));
    const own = screen.getByRole("tabpanel", { name: "Posts" });
    expect(within(own).getByRole("heading", { name: OWN_POSTS.heading })).toBeTruthy();
    expect(within(own).getByText(OWN_POSTS.body)).toBeTruthy();
  });

  it("W7-WEB-A-T9: a 404 profile shows This person is no longer in Explore., with the way back to Explore", async () => {
    renderProfile({ status: 404, body: { code: "listing_not_found", message: "This listing is gone." } });

    expect(await screen.findByRole("heading", { name: "This person is no longer in Explore." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Explore" }).getAttribute("href")).toBe("/explore");
  });

  it("W7-WEB-A-T9b: another error shows the server's sentence with Try again, which reads the profile again", async () => {
    renderProfile([{ status: 500, body: { code: "server_error", message: "Something went wrong on our side." } }, profileView({})]);

    expect(await screen.findByText("Something went wrong on our side.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await header()).toBeTruthy();
  });

  it("W6-DWEB-T28, moved to the profile: Meet their agent opens the picker without the couple group for a friend closed to dating questions, and with it for an open one", async () => {
    renderProfile(friendMira(true, { openToRomance: false }), { search: `?card=${IDS.card}` });
    fireEvent.click(within(await header()).getByRole("button", { name: "Meet their agent" }));
    const closedPicker = screen.getByRole("group", { name: "Pick a question for the meeting" });
    expect(screen.queryByRole("group", { name: "Would you get on as a couple?" })).toBeNull();
    expect(closedPicker.querySelectorAll('input[type="radio"]')).toHaveLength(17);
    cleanup();

    renderProfile(friendMira(true), { search: `?card=${IDS.card}` });
    fireEvent.click(within(await header()).getByRole("button", { name: "Meet their agent" }));
    const openPicker = screen.getByRole("group", { name: "Pick a question for the meeting" });
    expect(screen.getByRole("group", { name: "Would you get on as a couple?" }).querySelectorAll('input[type="radio"]')).toHaveLength(4);
    expect(openPicker.querySelectorAll('input[type="radio"]')).toHaveLength(21);
  });

  it("W6-DWEB-T29, moved to the profile: creating a meeting sends the question and this card, then opens the meeting page", async () => {
    const debate = CURATED_QUESTIONS.find((question) => question.id === 13);
    if (debate === undefined) throw new Error("curated question 13 is missing");
    renderProfile(friendMira(true), { search: `?card=${IDS.card}` });
    stubRoute(routes.directory.createListingMeeting, { status: 201, body: { meetingId: IDS.meeting } });

    fireEvent.click(within(await header()).getByRole("button", { name: "Meet their agent" }));
    fireEvent.click(screen.getByRole("radio", { name: debate.text }));
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));

    expect((await screen.findByTestId("location")).textContent).toBe(`/meetings/${IDS.meeting}`);
    expect(requestsTo(routes.directory.createListingMeeting)).toHaveLength(1);
    expect(requestsTo(routes.directory.createListingMeeting)[0]?.url).toContain(`/api/directory/${LISTING_IDS.mira}/meetings`);
    expect(requestsTo(routes.directory.createListingMeeting)[0]?.body).toEqual({ questionId: 13, cardId: IDS.card });
  });

  it("W6-DWEB-T30, moved to the profile: a refused meeting shows the server's sentence under the picker and the page stays", async () => {
    const sentence = "this persona has met as many people as it can today. Try again tomorrow.";
    renderProfile(friendMira(true), { search: `?card=${IDS.card}` });
    stubRoute(routes.directory.createListingMeeting, { status: 429, body: { code: "directory_daily_cap", message: sentence } });

    fireEvent.click(within(await header()).getByRole("button", { name: "Meet their agent" }));
    fireEvent.click(screen.getByRole("radio", { name: "Would we enjoy a 10-day hackathon together?" }));
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));

    expect((await screen.findByRole("alert")).textContent).toBe(sentence);
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByRole("group", { name: "Pick a question for the meeting" })).toBeTruthy();
  });

  it("W6-DWEB-T31, moved to the profile: free text outside 5 to 300 characters is refused before any request", async () => {
    renderProfile(friendMira(true), { search: `?card=${IDS.card}` });
    stubRoute(routes.directory.createListingMeeting, { status: 201, body: { meetingId: IDS.meeting } });

    fireEvent.click(within(await header()).getByRole("button", { name: "Meet their agent" }));
    fireEvent.click(screen.getByRole("radio", { name: "Write your own question" }));
    fireEvent.change(screen.getByLabelText("Your question (5 to 300 characters)"), { target: { value: "Hm?" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the meeting" }));

    expect(await screen.findByText("Write a question of 5 to 300 characters.")).toBeTruthy();
    expect(requestsTo(routes.directory.createListingMeeting)).toHaveLength(0);
  });

  it("W6-DWEB-T32, moved to the profile: with no card known a friend's profile shows no Meet button and says how to get one", async () => {
    renderProfile(friendMira(true));
    stubRoute(routes.directory.readMyListing, { status: 404, body: { code: "not_listed", message: "You are not in the directory." } });
    const head = await header();

    await waitFor(() => {
      expect(requestsTo(routes.directory.readMyListing)).toHaveLength(1);
    });
    expect(within(head).getByText("To meet their agent, open your approved card first.")).toBeTruthy();
    expect(within(head).queryByRole("button", { name: "Meet their agent" })).toBeNull();
  });

  it("W6-DWEB-T36, moved to the profile: every control on a friend's profile has an accessible name at 375 px, with the picker open", async () => {
    renderProfile(friendMira(true), { search: `?card=${IDS.card}` });
    fireEvent.click(within(await header()).getByRole("button", { name: "Meet their agent" }));

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
