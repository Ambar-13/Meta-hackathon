import { DirectoryListing, DirectoryPage, ListedMeetingsView, MyListing } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { DirectoryScreen } from "../../../screens/directory/index.js";
import { IDS, SERVER_NOW } from "../../fixtures.js";
import { FOREVER_MS, type GalleryReply, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { AfterSteps } from "./help.js";

// The directory with the fixture card in its address, as the card screen's link writes it, so Meet buttons show.
const URL_WITH_CARD = `/directory?card=${IDS.card}`;
// GET /api/directory/me for a person with no listing.
const NOT_LISTED: GalleryReply = { status: 404, body: { code: "not_listed", message: "You are not in the directory." } };
// A failed reply from the server, as the error states show it.
const SERVER_ERROR: GalleryReply = { status: 500, body: { code: "server_error", message: "Something went wrong on our side. Try again in a minute." } };

// Three listings of the gallery directory.
const LISTINGS = [
  DirectoryListing.parse({
    listingId: "00000000-0000-4000-8000-000000000511",
    displayName: "Mira",
    line: "Plans first, builds second, demos something small.",
    openToRomance: true,
    items: [
      { kind: "habit", claim: "Writes the plan before the first commit", quote: "I can't start until I know what done looks like." },
      { kind: "boundary", claim: "Done by 9 pm", quote: "After nine I am no use to anyone." },
      { kind: "value", claim: "Small demos that work", quote: "Show one thing that works, not ten that almost do." },
      { kind: "goal", claim: "Wants to ship a hardware hack", quote: "This year I want something you can hold." },
    ],
  }),
  DirectoryListing.parse({
    listingId: "00000000-0000-4000-8000-000000000512",
    displayName: "Jonah",
    line: "Night owl who builds to find out.",
    openToRomance: false,
    items: [{ kind: "preference", claim: "Builds to find out", quote: "Easier to show you than to explain it." }],
  }),
  DirectoryListing.parse({ listingId: "00000000-0000-4000-8000-000000000513", displayName: "Priyanka", line: "Design and front end, happy to pair.", openToRomance: false, items: [] }),
];

// The person's own listing, open to dating questions.
const MY_LISTING = MyListing.parse({
  listingId: "00000000-0000-4000-8000-000000000501",
  cardId: IDS.card,
  line: "Builds hackathon tools and likes a clear plan.",
  openToRomance: true,
  items: [{ kind: "value", claim: "Says no to scope creep", quote: "Someone has to say no to features." }],
  createdAt: SERVER_NOW,
});

// Two meetings the person's persona was in through the directory.
const MEETINGS = ListedMeetingsView.parse({
  meetings: [
    { meetingId: "00000000-0000-4000-8000-000000000521", otherDisplayName: "Jonah", questionText: "Would we enjoy a 10-day hackathon together?", state: "ended", createdAt: SERVER_NOW },
    { meetingId: "00000000-0000-4000-8000-000000000522", otherDisplayName: "Priyanka", questionText: "Should we split work by strengths?", state: "ready", createdAt: SERVER_NOW },
  ],
});

// One page of listings.
function page(listings: DirectoryListing[], hasMore: boolean): GalleryReply {
  return { status: 200, body: DirectoryPage.parse({ listings, page: 0, hasMore }) };
}

// The three reads the page makes when it opens, plus any extra stubs.
function reads(replies: { pages: GalleryReply | GalleryReply[]; listing?: GalleryReply; meetings?: GalleryReply }, extra: GalleryStub[] = []): GalleryStub[] {
  return [
    { route: routes.directory.browse, replies: replies.pages },
    { route: routes.directory.readMyListing, replies: replies.listing ?? NOT_LISTED },
    { route: routes.directory.listedMeetings, replies: replies.meetings ?? { status: 200, body: { meetings: [] } } },
    ...extra,
  ];
}

// The usual reads: three listings with more to come, the person's listing and two meetings.
const FULL_READS = { pages: page(LISTINGS, true), listing: { status: 200, body: MY_LISTING }, meetings: { status: 200, body: MEETINGS } };
// The steps that open Mira's picker, pick a question and create the meeting.
const CREATE_STEPS = [{ press: "Meet Mira" }, { press: "Would we enjoy a 10-day hackathon together?" }, { press: "Create the meeting" }] as const;

// The directory page in every state.
export const views: readonly GalleryView[] = [
  { name: "directory-ready", title: "Directory, listings and your listing", pattern: ROUTE_PATTERNS.directory, url: URL_WITH_CARD, element: <DirectoryScreen />, stubs: reads(FULL_READS) },
  { name: "directory-no-card", title: "Directory, no approved card known", pattern: ROUTE_PATTERNS.directory, url: "/directory", element: <DirectoryScreen />, stubs: reads({ pages: page(LISTINGS, false) }) },
  { name: "directory-picker", title: "Directory, the Meet picker open", pattern: ROUTE_PATTERNS.directory, url: URL_WITH_CARD, element: <AfterSteps steps={[{ press: "Meet Jonah" }]}><DirectoryScreen /></AfterSteps>, stubs: reads(FULL_READS) },
  {
    name: "directory-limit",
    title: "Directory, the daily limit reached",
    pattern: ROUTE_PATTERNS.directory,
    url: URL_WITH_CARD,
    element: <AfterSteps steps={CREATE_STEPS}><DirectoryScreen /></AfterSteps>,
    stubs: reads(FULL_READS, [{ route: routes.directory.createListingMeeting, replies: { status: 429, body: { code: "directory_daily_cap", message: "This persona has met as many people as it can today. Try again tomorrow." } } }]),
  },
  { name: "directory-empty", title: "Directory, nobody listed yet", pattern: ROUTE_PATTERNS.directory, url: URL_WITH_CARD, element: <DirectoryScreen />, stubs: reads({ pages: page([], false) }) },
  {
    name: "directory-no-match",
    title: "Directory, a search that finds nobody",
    pattern: ROUTE_PATTERNS.directory,
    url: URL_WITH_CARD,
    element: <AfterSteps steps={[{ type: "underwater robots", into: "Search the directory" }, { press: "Search" }]}><DirectoryScreen /></AfterSteps>,
    stubs: reads({ pages: [page(LISTINGS, false), page([], false)] }),
  },
  {
    name: "directory-left",
    title: "Directory, just left the directory",
    pattern: ROUTE_PATTERNS.directory,
    url: URL_WITH_CARD,
    element: <AfterSteps steps={[{ press: "Leave the directory" }]}><DirectoryScreen /></AfterSteps>,
    stubs: reads(FULL_READS, [{ route: routes.directory.leave, replies: { status: 204, body: null } }]),
  },
  { name: "directory-loading", title: "Directory, loading", pattern: ROUTE_PATTERNS.directory, url: URL_WITH_CARD, element: <DirectoryScreen />, stubs: reads({ pages: { ...page(LISTINGS, false), delayMs: FOREVER_MS }, listing: { status: 200, body: MY_LISTING, delayMs: FOREVER_MS } }) },
  { name: "directory-error", title: "Directory, the listings failed", pattern: ROUTE_PATTERNS.directory, url: URL_WITH_CARD, element: <DirectoryScreen />, stubs: reads({ pages: SERVER_ERROR, listing: SERVER_ERROR }) },
];
