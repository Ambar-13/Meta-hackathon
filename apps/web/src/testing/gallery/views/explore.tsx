import { DirectoryListing, DirectoryPage, FriendRequestsView, FriendsView, type Friend, type FriendRequestView } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { ExploreScreen } from "../../../screens/explore/index.js";
import { FOREVER_MS, type GalleryReply, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { AfterSteps } from "./help.js";
import { SERVER_NOW } from "../../fixtures.js";

// The gallery's fixed ids for the rail, which the other wave 7 views reuse.
const ID = (n: number): string => `00000000-0000-4000-8000-${String(950 + n).padStart(12, "0")}`;
// Fourteen first names, so the rail shows 12 and then See all friends.
const NAMES = ["Bea", "Cal", "Jonah", "Maximiliana", "Ola", "Pim", "Ravi", "Sung-min", "Tomasz", "Uma", "Vik", "Wren", "Yara", "Zed"];

// The first count friends for the rail; every other one is in Explore and links to their profile.
export function railFriends(count: number): Friend[] {
  return NAMES.slice(0, count).map((displayName, index) => ({ pairId: ID(index), displayName, canAsk: index % 3 !== 1, listingId: index % 2 === 0 ? ID(20 + index) : null }));
}

// count incoming friend requests for the rail's Friends count.
export function railRequests(count: number): FriendRequestView[] {
  return Array.from({ length: count }, (unused, index) => ({ requestId: ID(40 + index), direction: "incoming" as const, otherName: ["Ines", "Kofi", "Lena"][index % 3] ?? "Ines", otherListingId: null, createdAt: SERVER_NOW }));
}

// The two reads of the rail: these friends and these incoming requests.
export function railStubs(friends: Friend[], incoming: FriendRequestView[] = []): GalleryStub[] {
  const ok = (body: unknown): GalleryReply => ({ status: 200, body });
  return [
    { route: routes.directory.friends, replies: ok(FriendsView.parse({ friends })) },
    { route: routes.social.listFriendRequests, replies: ok(FriendRequestsView.parse({ incoming, outgoing: [] })) },
  ];
}

// The gallery's fixed listing ids.
const LISTING = (n: number): string => `00000000-0000-4000-8000-${String(510 + n).padStart(12, "0")}`;
// Six people in Explore: long and short names and lines, open and closed to dating questions, one with nothing public.
export const EXPLORE_LISTINGS: DirectoryListing[] = [
  { listingId: LISTING(1), displayName: "Mira", line: "Plans first, builds second, demos something small.", openToRomance: true, items: [{ kind: "habit", claim: "Writes the plan before the first commit", quote: "I can't start until I know what done looks like." }] },
  { listingId: LISTING(2), displayName: "Jonah", line: "Night owl who builds to find out.", openToRomance: false, items: [{ kind: "preference", claim: "Builds to find out", quote: "Easier to show you than to explain it." }] },
  { listingId: LISTING(3), displayName: "Priyanka", line: "Design and front end, happy to pair on anything with a screen, and keen to learn some hardware this year.", openToRomance: false, items: [] },
  { listingId: LISTING(4), displayName: "Maximiliana", line: "Robotics, coffee, long walks between talks.", openToRomance: true, items: [{ kind: "goal", claim: "Wants to ship a hardware hack that people can hold in their hands", quote: "This year I want something you can hold." }] },
  { listingId: LISTING(5), displayName: "Ravi", line: "Backend and data. Says no to scope creep.", openToRomance: false, items: [{ kind: "value", claim: "Says no to scope creep", quote: "Someone has to say no to features." }] },
  { listingId: LISTING(6), displayName: "Sung-min", line: "First hackathon, here to meet people.", openToRomance: false, items: [{ kind: "boundary", claim: "Done by 9 pm", quote: "After nine I am no use to anyone." }] },
].map((listing) => DirectoryListing.parse(listing));

// One page of Explore.
function page(listings: DirectoryListing[], hasMore: boolean): GalleryReply {
  return { status: 200, body: DirectoryPage.parse({ listings, page: 0, hasMore }) };
}

// The page's reads: these Explore replies and a rail with five friends.
function reads(pages: GalleryReply | GalleryReply[]): GalleryStub[] {
  return [...railStubs(railFriends(5)), { route: routes.directory.browse, replies: pages }];
}

// One view of Explore on its route.
function exploreView(head: { name: string; title: string }, stubs: GalleryStub[], element = <ExploreScreen />): GalleryView {
  return { ...head, pattern: ROUTE_PATTERNS.explore, url: "/explore", element, stubs };
}

// Explore: the grid of people with more to show, a search that finds nobody, loading, and a failed load.
export const views: readonly GalleryView[] = [
  exploreView({ name: "explore-grid", title: "Explore, the grid of people" }, reads(page(EXPLORE_LISTINGS, true))),
  exploreView(
    { name: "explore-empty", title: "Explore, a search that finds nobody" },
    reads([page(EXPLORE_LISTINGS, false), page([], false)]),
    <AfterSteps steps={[{ type: "underwater robots", into: "Search Explore" }, { press: "Search" }]}><ExploreScreen /></AfterSteps>,
  ),
  exploreView({ name: "explore-loading", title: "Explore, loading" }, reads({ ...page(EXPLORE_LISTINGS, false), delayMs: FOREVER_MS })),
  exploreView({ name: "explore-error", title: "Explore, the people failed to load" }, reads({ status: 500, body: { code: "server_error", message: "Something went wrong on our side. Try again in a minute." } })),
];
