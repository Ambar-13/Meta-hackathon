import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DirectoryListing, DirectoryPage, type FriendsView, type PostsView } from "@meet-first/contracts";
import { APP_PATHS, chatPathWithDraft, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { LISTING_IDS } from "../../testing/fixtures.js";
import { ExploreScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// One listing with one public item; isOpen says whether it takes dating questions.
function listing(listingId: string, displayName: string, isOpen: boolean): DirectoryListing {
  return DirectoryListing.parse({
    listingId,
    displayName,
    line: `${displayName} builds small tools`,
    openToRomance: isOpen,
    isSample: false,
    items: [{ kind: "habit", claim: `${displayName} starts work early`, quote: `I am at my desk by seven, says ${displayName}` }],
  });
}

// One page of Explore.
function page(pageNumber: number, listings: DirectoryListing[], hasMore: boolean): DirectoryPage {
  return DirectoryPage.parse({ listings, page: pageNumber, hasMore });
}

// Post number n by Mira or Ravi (Ravi is a sample person here), hoursAgo hours old.
function post(n: number, writer: "Mira" | "Ravi", hoursAgo: number): PostsView["posts"][number] {
  const listingId = writer === "Mira" ? LISTING_IDS.mira : LISTING_IDS.ravi;
  return { postId: `00000000-0000-4000-8000-00000000070${String(n)}`, listingId, displayName: writer, isSample: writer === "Ravi", text: `Post number ${String(n)} by ${writer}.`, createdAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString() };
}

// What Explore's other two reads answer in a test: the replies for GET /api/posts, and the friends list.
type OtherReads = { posts?: StubInput[]; friends?: FriendsView };

// Renders Explore with these replies for GET /api/directory; no posts and no friends unless given.
function renderExplore(pages: StubInput[], others: OtherReads = {}): void {
  stubRoute(routes.social.listPosts, others.posts ?? [{ posts: [] }]);
  stubRoute(routes.directory.friends, others.friends ?? { friends: [] });
  stubRoute(routes.directory.browse, pages);
  renderScreen(<ExploreScreen />, { pattern: ROUTE_PATTERNS.explore, url: APP_PATHS.explore });
}

// The address values of the nth request to GET /api/directory, counted from 0.
function browseParams(index: number): URLSearchParams {
  const request = requestsTo(routes.directory.browse)[index];
  if (request === undefined) throw new Error(`no directory request ${String(index)}`);
  return new URL(request.url).searchParams;
}

// The link of the person with this name: the link that holds their name heading, a card in the feed or a row in a list.
async function personLinkOf(name: string): Promise<HTMLElement> {
  const link = (await screen.findByRole("heading", { name })).closest("a");
  if (link === null) throw new Error(`the name of ${name} is not in a link`);
  return link;
}

const MIRA = listing(LISTING_IDS.mira, "Mira", true);
const RAVI = listing(LISTING_IDS.ravi, "Ravi", false);
const SAMPLE_RAVI = { ...RAVI, isSample: true };

describe("Explore page, against the MSW route stubs (a fake server)", () => {
  it("W7-WEB-A-T4: each person is one link to /people/:listingId, a search sends the query, and the empty state shows its title", async () => {
    renderExplore([page(0, [MIRA, RAVI], false), page(0, [], false)]);

    expect((await personLinkOf("Mira")).getAttribute("href")).toBe(`/people/${LISTING_IDS.mira}`);
    expect((await personLinkOf("Ravi")).getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}`);

    fireEvent.change(screen.getByRole("textbox", { name: "Search Explore" }), { target: { value: "robots" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("heading", { name: "Nobody matches yet" })).toBeTruthy();
    expect(screen.getByText("Try other words, or clear the search.")).toBeTruthy();
    expect(browseParams(1).get("query")).toBe("robots");
  });

  it("W6-DWEB-T24, moved to Explore: a suggested card shows the name, the line and the dating words only when open; after See all each row also shows the first public item's claim; nothing shows an id or a number", async () => {
    renderExplore([page(0, [MIRA, RAVI], false)]);
    const miraCard = await personLinkOf("Mira");

    expect(within(miraCard).getByText("Mira builds small tools")).toBeTruthy();
    expect(within(miraCard).getByText("Open to dating questions")).toBeTruthy();
    expect(within(await personLinkOf("Ravi")).queryByText("Open to dating questions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See all" }));

    expect(await screen.findByRole("heading", { name: "Everyone in Explore" })).toBeTruthy();
    const mira = await personLinkOf("Mira");
    const ravi = await personLinkOf("Ravi");
    expect(within(mira).getByText("Mira builds small tools")).toBeTruthy();
    expect(within(mira).getByText("Mira starts work early")).toBeTruthy();
    expect(within(mira).getByText("Open to dating questions")).toBeTruthy();
    expect(within(ravi).queryByText("Open to dating questions")).toBeNull();
    expect(mira.textContent).not.toMatch(/[0-9]/);
    expect(document.body.textContent).not.toContain(LISTING_IDS.mira);
    expect(document.body.textContent).not.toContain(LISTING_IDS.ravi);
    fireEvent.click(screen.getByRole("button", { name: "Back to posts" }));

    expect(await screen.findByRole("region", { name: "Suggested for you" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Everyone in Explore" })).toBeNull();
  });

  it("W6-DWEB-T25, moved to Explore: Show more loads the next page of the same search after the first, then goes away", async () => {
    renderExplore([page(0, [MIRA], true), page(1, [RAVI], false)]);
    await personLinkOf("Mira");

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("heading", { name: "Ravi" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(browseParams(1).get("page")).toBe("1");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("W6-DWEB-T26, moved to Explore: a search sends the trimmed words from page 0 and replaces the people; the first load sends no words", async () => {
    renderExplore([page(0, [MIRA, RAVI], false), page(0, [RAVI], false)]);
    await personLinkOf("Mira");

    fireEvent.change(screen.getByRole("textbox", { name: "Search Explore" }), { target: { value: "  starts early  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Mira" })).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "Ravi" })).toBeTruthy();
    expect([browseParams(0).get("query"), browseParams(0).get("page")]).toEqual([null, "0"]);
    expect([browseParams(1).get("query"), browseParams(1).get("page")]).toEqual(["starts early", "0"]);
  });

  it("W6-DWEB-T27, moved to Explore: an empty Explore and a search that finds nobody each show the empty state", async () => {
    renderExplore([page(0, [], false), page(0, [], false)]);

    expect(await screen.findByRole("heading", { name: "Nobody matches yet" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Explore" }), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(requestsTo(routes.directory.browse)).toHaveLength(2);
    });
    expect(await screen.findByRole("heading", { name: "Nobody matches yet" })).toBeTruthy();
  });

  it("W7-WEB-A-T4b: a failed load shows the server's sentence and Try again loads again; the help line links to the chat", async () => {
    renderExplore([{ status: 500, body: { code: "server_error", message: "Something went wrong on our side." } }, page(0, [MIRA], false)]);

    expect(await screen.findByText("Something went wrong on our side.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask Meety who could help." }).getAttribute("href")).toBe("/home");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(screen.queryByText("Something went wrong on our side.")).toBeNull();
  });

  it("W6-DWEB-T36, moved to Explore: every control on Explore has an accessible name at 375 px", async () => {
    renderExplore([page(0, [MIRA, RAVI], true)], { posts: [{ posts: [post(1, "Ravi", 1), post(2, "Mira", 2), post(3, "Ravi", 3)] }] });
    await personLinkOf("Mira");
    await screen.findByText("Post number 3 by Ravi.");

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W7-SAMPLE-WEB-T1: the feed shows the posts newest first with the suggested people after the second; each post has its writer's name linking to their profile, the Sample mark, its age, their line and More from them; a search shows people only", async () => {
    renderExplore([page(0, [MIRA, SAMPLE_RAVI], false), page(0, [SAMPLE_RAVI], false)], { posts: [{ posts: [post(1, "Ravi", 3), post(2, "Mira", 30), post(3, "Mira", 50)] }] });
    const feed = await screen.findByRole("region", { name: "Posts in Explore" });
    await within(feed).findByText("Post number 3 by Mira.");
    const posts = within(feed).getAllByRole("article");
    const suggested = within(feed).getByRole("region", { name: "Suggested for you" });
    const [first, second, third] = posts as [HTMLElement, HTMLElement, HTMLElement];

    expect(posts.map((article) => article.getAttribute("aria-label"))).toEqual(["Ravi's post", "Mira's post", "Mira's post"]);
    expect(second.compareDocumentPosition(suggested) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(suggested.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(first).getByText("Post number 1 by Ravi.")).toBeTruthy();
    expect(within(first).getByRole("link", { name: "Ravi" }).getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}`);
    expect(within(first).getByRole("link", { name: "Ravi's posts" }).getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}?tab=posts`);
    expect(within(first).getByText("Sample")).toBeTruthy();
    expect(within(first).getByText("3 hours ago")).toBeTruthy();
    expect(within(first).getByText("Ravi builds small tools")).toBeTruthy();
    expect(within(second).queryByText("Sample")).toBeNull();
    expect(within(await personLinkOf("Ravi")).getByText("Sample")).toBeTruthy();
    expect(within(await personLinkOf("Mira")).queryByText("Sample")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Search Explore" }), { target: { value: "ravi" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Mira" })).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "People" })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("W7-SAMPLE-WEB-T2: when the posts do not load, the people still show, with a line and Try again for the posts", async () => {
    renderExplore([page(0, [MIRA, RAVI], false)], {
      posts: [{ status: 500, body: { code: "server_error", message: "Something went wrong on our side." } }, { posts: [post(1, "Ravi", 1)] }],
    });

    expect(await screen.findByText("Posts did not load.")).toBeTruthy();
    expect(await personLinkOf("Mira")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("article", { name: "Ravi's post" })).toBeTruthy();
    expect(screen.queryByText("Posts did not load.")).toBeNull();
  });

  it("W7-FEED-T1: Add friend on a sample person's post sends the request for their listing and shows Friends at once; on a real person's card it shows Requested", async () => {
    stubRoute(routes.social.sendFriendRequest, { status: 201, body: { requestId: LISTING_IDS.request } });
    renderExplore([page(0, [MIRA, SAMPLE_RAVI], false)], { posts: [{ posts: [post(1, "Ravi", 1)] }] });
    const ravisPost = await screen.findByRole("article", { name: "Ravi's post" });

    fireEvent.click(within(ravisPost).getByRole("button", { name: "Add Ravi as a friend" }));

    expect(await within(ravisPost).findByText("Friends")).toBeTruthy();
    expect(requestsTo(routes.social.sendFriendRequest)[0]?.body).toEqual({ listingId: LISTING_IDS.ravi });
    const suggested = screen.getByRole("region", { name: "Suggested for you" });
    fireEvent.click(within(suggested).getByRole("button", { name: "Add Mira as a friend" }));

    expect(await within(suggested).findByText("Requested")).toBeTruthy();
    expect(requestsTo(routes.social.sendFriendRequest)[1]?.body).toEqual({ listingId: LISTING_IDS.mira });
  });

  it("W7-FEED-T2: a friend's post shows no Add friend, and Ask NAME's Meety opens the chat with their name in the box when their Meety can be asked; for anyone else it says why under the post", async () => {
    const friends: FriendsView = { friends: [{ pairId: LISTING_IDS.request, displayName: "Mira", canAsk: true, listingId: LISTING_IDS.mira }] };
    renderExplore([page(0, [MIRA, RAVI], false)], { posts: [{ posts: [post(1, "Mira", 1), post(2, "Ravi", 2)] }], friends });
    const mirasPost = await screen.findByRole("article", { name: "Mira's post" });
    const ask = await within(mirasPost).findByRole("link", { name: "Ask Mira's Meety" });

    expect(ask.getAttribute("href")).toBe(chatPathWithDraft("How would Mira react to "));
    expect(within(mirasPost).queryByRole("button", { name: /as a friend/ })).toBeNull();
    const ravisPost = screen.getByRole("article", { name: "Ravi's post" });
    expect(within(ravisPost).queryByRole("link", { name: "Ask Ravi's Meety" })).toBeNull();
    expect(within(ravisPost).getByRole("button", { name: "Add Ravi as a friend" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Suggested for you" })).getByText("Friends")).toBeTruthy();
    const askRavi = within(ravisPost).getByRole("button", { name: "Ask Ravi's Meety" });
    fireEvent.click(askRavi);

    expect(askRavi.getAttribute("aria-expanded")).toBe("true");
    expect(within(ravisPost).getByRole("status").textContent).toBe("Ravi's Meety answers questions from Ravi's friends. Add Ravi as a friend first.");
  });

  it("W7-NOTE-T3: a post whose writer shared a matching item shows their own words from it, one link to their profile; a post with none shows no line", async () => {
    const withHardware = DirectoryListing.parse({ ...RAVI, items: [{ kind: "habit", claim: "Writes the rollback before the change", quote: "I write the rollback first. If I can't undo a change, I am not ready" }] });
    const rollbackPost = { ...post(1, "Ravi", 1), text: "Before every demo I ask one question: what is the undo?" };
    renderExplore([page(0, [MIRA, withHardware], false)], { posts: [{ posts: [rollbackPost, post(2, "Mira", 2)] }] });
    const ravisPost = await screen.findByRole("article", { name: "Ravi's post" });
    const note = await within(ravisPost).findByRole("link", { name: /From what Ravi shared/ });

    expect(note.textContent).toContain("I write the rollback first. If I can't undo a change, I am not ready");
    expect(note.getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}`);
    expect(within(screen.getByRole("article", { name: "Mira's post" })).queryByRole("link", { name: /From what Mira shared/ })).toBeNull();
  });

  it("W7-RAIL-T1: the right-hand column says what your Meety does with a link to Me, lists people you are not friends with yet, and See everyone opens everyone", async () => {
    const friends: FriendsView = { friends: [{ pairId: LISTING_IDS.request, displayName: "Mira", canAsk: true, listingId: LISTING_IDS.mira }] };
    renderExplore([page(0, [MIRA, RAVI], false)], { friends });
    const rail = await screen.findByRole("complementary", { name: "Your Meety and people you might click with" });

    expect(within(rail).getByRole("heading", { name: "Let your Meety go first." })).toBeTruthy();
    expect(within(rail).getByRole("link", { name: "See what it shares" }).getAttribute("href")).toBe(APP_PATHS.me);
    await waitFor(() => {
      expect(within(rail).queryByRole("link", { name: "Mira" })).toBeNull();
    });
    expect(within(rail).getByRole("link", { name: "Ravi" }).getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}`);
    fireEvent.click(within(rail).getByRole("button", { name: "See everyone" }));

    expect(await screen.findByRole("heading", { name: "Everyone in Explore" })).toBeTruthy();
  });
});
