import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DirectoryListing, DirectoryPage, type FriendsView, type PostsView, type Story } from "@meet-first/contracts";
import { APP_PATHS, chatPathWithDraft, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { LISTING_IDS } from "../../testing/fixtures.js";
import { homeOf } from "../chat/chat-fixtures.js";
import { FeedScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
  window.localStorage.removeItem("meet-first-stories-seen");
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

// One story by a person, hoursAgo hours old: Ravi and Mira by their listings, yours with no listing.
function story(n: number, writer: "Mira" | "Ravi" | "You", hoursAgo: number): Story {
  const listingId = { Mira: LISTING_IDS.mira, Ravi: LISTING_IDS.ravi, You: null }[writer];
  return {
    storyId: `00000000-0000-4000-8000-00000000075${String(n)}`, listingId, displayName: writer === "You" ? "Ana" : writer, isSample: false, isMine: writer === "You",
    authorPhoto: null, text: `Story number ${String(n)} by ${writer}.`, photo: null, photoAlt: null,
    createdAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

// What the feed's other reads answer in a test: the replies for GET /api/posts and GET /api/stories, the friends list, and whether the
// card is approved.
type OtherReads = { posts?: StubInput[]; stories?: StubInput[]; friends?: FriendsView; hasCard?: boolean };

// Renders Home, the feed, with these replies for GET /api/directory; no posts, no stories, no friends and an approved card unless given.
function renderFeed(pages: StubInput[], others: OtherReads = {}): void {
  stubRoute(routes.social.listPosts, others.posts ?? [{ posts: [] }]);
  stubRoute(routes.social.listStories, others.stories ?? [{ stories: [] }]);
  stubRoute(routes.directory.friends, others.friends ?? { friends: [] });
  stubRoute(routes.people.readHome, homeOf(others.hasCard ?? true));
  stubRoute(routes.directory.browse, pages);
  renderScreen(<FeedScreen />, { pattern: ROUTE_PATTERNS.home, url: APP_PATHS.home });
}

// The link of the person with this name: the link that holds their name heading, a card in the feed or a row in a list.
async function personLinkOf(name: string): Promise<HTMLElement> {
  const link = (await screen.findByRole("heading", { name })).closest("a");
  if (link === null) throw new Error(`the name of ${name} is not in a link`);
  return link;
}

// The same post with a photo: this key and these words for it.
function withPhoto(base: PostsView["posts"][number], photo: string, photoAlt: string): PostsView["posts"][number] {
  return { ...base, photo, photoAlt };
}

const MIRA = listing(LISTING_IDS.mira, "Mira", true);
const RAVI = listing(LISTING_IDS.ravi, "Ravi", false);
const SAMPLE_RAVI = { ...RAVI, isSample: true };

describe("Home, the feed, against the MSW route stubs (a fake server)", () => {
  it("W6-DWEB-T24, moved to Home: a suggested card shows the name, the line and the dating words only when open, never an id or a number, and See all opens Search", async () => {
    renderFeed([page(0, [MIRA, RAVI], false)]);
    const miraCard = await personLinkOf("Mira");

    expect(within(miraCard).getByText("Mira builds small tools")).toBeTruthy();
    expect(within(miraCard).getByText("Open to dating questions")).toBeTruthy();
    expect(within(await personLinkOf("Ravi")).queryByText("Open to dating questions")).toBeNull();
    expect(miraCard.textContent).not.toMatch(/[0-9]/);
    expect(document.body.textContent).not.toContain(LISTING_IDS.mira);
    const suggested = screen.getByRole("region", { name: "Suggested for you" });
    expect(within(suggested).getByRole("link", { name: "See all" }).getAttribute("href")).toBe(APP_PATHS.search);
  });

  it("W6-DWEB-T27, moved to Home: with nobody in Explore and no posts, the feed says so and offers Search", async () => {
    renderFeed([page(0, [], false)]);

    const empty = (await screen.findByRole("heading", { name: "Nothing here yet" })).closest("section");
    expect(empty === null ? null : within(empty).getByRole("link", { name: "Search" }).getAttribute("href")).toBe(APP_PATHS.search);
  });

  it("W7-WEB-A-T4b: a failed load shows the server's sentence, and Try again loads again", async () => {
    renderFeed([{ status: 500, body: { code: "server_error", message: "Something went wrong on our side." } }, page(0, [MIRA], false)]);

    expect(await screen.findByText("Something went wrong on our side.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(screen.queryByText("Something went wrong on our side.")).toBeNull();
  });

  it("W7-HOME-T1: Home is the feed with no tabs and no search box, and shows your next step while your card is not approved", async () => {
    renderFeed([page(0, [MIRA], false)], { hasCard: false, posts: [{ posts: [post(1, "Mira", 1)] }] });

    expect(await screen.findByRole("article", { name: "Mira's post" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
    expect(await screen.findByRole("region", { name: "Your next step" })).toBeTruthy();
  });

  it("W6-DWEB-T36, moved to Home: every control on Home has an accessible name at 375 px", async () => {
    renderFeed([page(0, [MIRA, RAVI], true)], { posts: [{ posts: [post(1, "Ravi", 1), post(2, "Mira", 2), post(3, "Ravi", 3)] }] });
    await personLinkOf("Mira");
    await screen.findByText("Post number 3 by Ravi.");

    expect(window.innerWidth).toBe(375);
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W7-SAMPLE-WEB-T1: the feed shows the posts newest first with the suggested people after the second; each post has its writer's name linking to their profile, the sample mark, its age, their line and Posts", async () => {
    renderFeed([page(0, [MIRA, SAMPLE_RAVI], false), page(0, [SAMPLE_RAVI], false)], { posts: [{ posts: [post(1, "Ravi", 3), post(2, "Mira", 30), post(3, "Mira", 50)] }] });
    const feed = await screen.findByRole("region", { name: "Posts" });
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
    expect(within(first).getByText("Sample person")).toBeTruthy();
    expect(first.querySelector(".feed-avatar .made-up-mark")).not.toBeNull();
    expect(within(first).getByText("3 hours ago")).toBeTruthy();
    expect(within(first).getByText("Ravi builds small tools")).toBeTruthy();
    expect(within(second).queryByText("Sample person")).toBeNull();
    expect(second.querySelector(".feed-avatar .made-up-mark")).toBeNull();
    expect(within(await personLinkOf("Ravi")).getByText("Sample")).toBeTruthy();
    expect(within(await personLinkOf("Mira")).queryByText("Sample")).toBeNull();
  });

  it("W7-SAMPLE-WEB-T2: when the posts do not load, the people still show, with a line and Try again for the posts", async () => {
    renderFeed([page(0, [MIRA, RAVI], false)], {
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
    renderFeed([page(0, [MIRA, SAMPLE_RAVI], false)], { posts: [{ posts: [post(1, "Ravi", 1)] }] });
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
    renderFeed([page(0, [MIRA, RAVI], false)], { posts: [{ posts: [post(1, "Mira", 1), post(2, "Ravi", 2)] }], friends });
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
    renderFeed([page(0, [MIRA, withHardware], false)], { posts: [{ posts: [rollbackPost, post(2, "Mira", 2)] }] });
    const ravisPost = await screen.findByRole("article", { name: "Ravi's post" });
    const note = await within(ravisPost).findByRole("link", { name: /From what Ravi shared/ });

    expect(note.textContent).toContain("I write the rollback first. If I can't undo a change, I am not ready");
    expect(note.getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}`);
    expect(within(screen.getByRole("article", { name: "Mira's post" })).queryByRole("link", { name: /From what Mira shared/ })).toBeNull();
  });

  it("W7-RAIL-T1: the right-hand column says what your Meety does with a link to Me, lists people you are not friends with yet, and See everyone opens Search", async () => {
    const friends: FriendsView = { friends: [{ pairId: LISTING_IDS.request, displayName: "Mira", canAsk: true, listingId: LISTING_IDS.mira }] };
    renderFeed([page(0, [MIRA, RAVI], false)], { friends });
    const rail = await screen.findByRole("complementary", { name: "Your Meety and people you might click with" });

    expect(within(rail).getByRole("heading", { name: "You're more than your posts." })).toBeTruthy();
    expect(within(rail).getByRole("link", { name: "See what it shares" }).getAttribute("href")).toBe(APP_PATHS.me);
    await waitFor(() => {
      expect(within(rail).queryByRole("link", { name: "Mira" })).toBeNull();
    });
    expect(within(rail).getByRole("link", { name: "Ravi" }).getAttribute("href")).toBe(`/people/${LISTING_IDS.ravi}`);
    expect(within(rail).getByRole("link", { name: "See everyone" }).getAttribute("href")).toBe(APP_PATHS.search);
  });
  it("W7-PHOTO-T1: a post with a photo shows it with its words for the photo; a sample writer's picture is their face with the orange made-up mark, a real writer's their initial", async () => {
    const ravisPost = { ...withPhoto(post(1, "Ravi", 1), "ravi-whiteboard", "A hand drawing circles and arrows on a whiteboard."), authorPhoto: "faces/ravi" };
    renderFeed([page(0, [MIRA, SAMPLE_RAVI], false)], { posts: [{ posts: [ravisPost, post(2, "Mira", 2)] }] });
    const ravis = await screen.findByRole("article", { name: "Ravi's post" });
    const miras = screen.getByRole("article", { name: "Mira's post" });

    expect(within(ravis).getByRole("img", { name: "A hand drawing circles and arrows on a whiteboard." }).getAttribute("src")).toContain("ravi-whiteboard");
    expect(within(miras).queryByRole("img")).toBeNull();
    const ravisPicture = ravis.querySelector(".feed-avatar .person-avatar");
    const mirasPicture = miras.querySelector(".feed-avatar .person-avatar");
    expect(ravisPicture?.querySelector("img")?.getAttribute("src")).toContain("ravi");
    expect(ravisPicture?.querySelector(".made-up-mark")).not.toBeNull();
    expect(mirasPicture?.querySelector("img")).toBeNull();
    expect(mirasPicture?.querySelector(".made-up-mark")).toBeNull();
    expect(mirasPicture?.textContent).toBe("M");
  });

  it("W7-STORY-WEB-T1: the row starts with Your story, ready for a story in Create, then people with a story; a face opens the viewer, which plays each person's stories oldest first and moves on to the next person, and Escape closes it with the face shown as watched", async () => {
    const stories = [story(1, "Ravi", 1), story(2, "Mira", 2), story(3, "Ravi", 3)];
    renderFeed([page(0, [MIRA, RAVI], false)], { stories: [{ stories }] });
    const row = await screen.findByRole("region", { name: "Stories" });
    const ravi = await within(row).findByRole("button", { name: "Ravi, new story" });

    expect(within(row).getByRole("link", { name: "Add to your story" }).getAttribute("href")).toBe("/create?kind=story");
    expect(within(row).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Ravi, new story", "Mira, new story"]);
    fireEvent.click(ravi);
    const viewer = screen.getByRole("dialog", { name: "Ravi: story 1 of 2" });
    expect(within(viewer).getByText("Story number 3 by Ravi.")).toBeTruthy();
    expect(document.activeElement).toBe(within(viewer).getByRole("button", { name: "Close" }));
    fireEvent.click(within(viewer).getByRole("button", { name: "Next story" }));
    expect(screen.getByRole("dialog", { name: "Ravi: story 2 of 2" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next story" }));
    expect(screen.getByRole("dialog", { name: "Mira: story 1 of 1" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "Ravi: story 1 of 2" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(row).getByRole("button", { name: "Ravi, story" })).toBeTruthy();
    expect(unlabelledControls(row)).toEqual([]);
  });

  it("W7-STORY-WEB-T2: your own story leads the row in place of Your story's add link, Pause stops it, and Delete story asks once more, deletes it and reads the stories again", async () => {
    const mine = story(4, "You", 1);
    stubRoute(routes.social.deletePost, { status: 204, body: null });
    renderFeed([page(0, [MIRA], false)], { stories: [{ stories: [mine, story(5, "Mira", 2)] }, { stories: [story(5, "Mira", 2)] }] });
    const row = await screen.findByRole("region", { name: "Stories" });
    const yours = await within(row).findByRole("button", { name: "Your story, new story" });
    expect(within(row).queryByRole("link", { name: "Add to your story" })).toBeNull();
    fireEvent.click(yours);
    const viewer = screen.getByRole("dialog", { name: "Your story: story 1 of 1" });

    const pause = within(viewer).getByRole("button", { name: "Pause" });
    fireEvent.click(pause);
    expect(within(viewer).getByRole("button", { name: "Play" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(viewer).getByRole("link", { name: "Add to your story" }).getAttribute("href")).toBe("/create?kind=story");
    fireEvent.click(within(viewer).getByRole("button", { name: "Delete story" }));
    fireEvent.click(within(viewer).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(requestsTo(routes.social.deletePost)[0]?.url).toContain(`/api/posts/${mine.storyId}`);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(await within(row).findByRole("link", { name: "Add to your story" })).toBeTruthy();
  });

  it("W7-LIKE-WEB-T1: Like fills the heart at once and sends PUT, a second tap sends DELETE, and a refused like goes back and says why", async () => {
    const mira = { ...post(1, "Mira", 1), isLiked: false, isMine: false };
    stubRoute(routes.social.likePost, [{ postId: mira.postId, isLiked: true }, { status: 500, body: { code: "server_error", message: "Something went wrong on our side." } }]);
    stubRoute(routes.social.unlikePost, { postId: mira.postId, isLiked: false });
    renderFeed([page(0, [MIRA], false)], { posts: [{ posts: [mira] }] });
    const like = await screen.findByRole("button", { name: "Like Mira's post" });

    expect(like.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(like);
    expect(like.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => {
      expect(requestsTo(routes.social.likePost)[0]?.url).toContain(`/api/posts/${mira.postId}/like`);
    });
    fireEvent.click(like);
    expect(like.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => {
      expect(requestsTo(routes.social.unlikePost)).toHaveLength(1);
    });
    fireEvent.click(like);
    expect(await screen.findByText("Something went wrong on our side.")).toBeTruthy();
    expect(like.getAttribute("aria-pressed")).toBe("false");
  });

  it("W7-SHARE-WEB-T5: your own post shows with Like, Posts leading to your own Posts tab and Delete, and no Add friend or Ask", async () => {
    const own = { ...post(2, "Mira", 1), displayName: "Ana", listingId: LISTING_IDS.mine, isMine: true, isLiked: false };
    renderFeed([page(0, [MIRA], false)], { posts: [{ posts: [own] }] });
    const article = await screen.findByRole("article", { name: "Your post" });

    expect(within(article).getByRole("link", { name: "Ana" }).getAttribute("href")).toBe(APP_PATHS.me);
    expect(within(article).getByRole("button", { name: "Like your post" })).toBeTruthy();
    expect(within(article).getByRole("link", { name: "Your posts" }).getAttribute("href")).toBe("/me?tab=posts");
    expect(within(article).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(article).queryByRole("button", { name: /Add .* as a friend/ })).toBeNull();
    expect(within(article).queryByText(/Ask .*'s Meety/)).toBeNull();
  });
});
