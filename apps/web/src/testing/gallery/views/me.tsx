import { ListedMeetingsView, MyListing, type HomeView } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { MeScreen } from "../../../screens/me/index.js";
import { IDS, profileView, SERVER_NOW } from "../../fixtures.js";
import type { GalleryReply, GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { railFriends, railStubs } from "./explore.js";
import { AfterSteps } from "./help.js";

// The person's listing id, and the meeting Priyanka started with Ana in Explore.
const MINE = "00000000-0000-4000-8000-000000000501";
const EXPLORE_MEETING = "00000000-0000-4000-8000-000000000521";
// The person's home: an approved card, an ended meeting with its brief, the one Priyanka started in Explore (the home list holds it
// too, as the server's does), and an open invite.
const HOME: HomeView = {
  displayName: "Ana",
  source: { id: IDS.source, namesPassDone: true, namesReviewed: true },
  card: { id: IDS.card, state: "approved", itemCount: 4, items: [{ kind: "habit", claim: "Plans before building", quote: "I can't start until I know what done looks like." }, { kind: "value", claim: "Says no to scope creep", quote: "Someone has to say no to features." }] },
  meetings: [
    { id: IDS.meeting, questionText: "Would we enjoy a 10-day hackathon together?", questionKind: "get_along", state: "ended", otherDisplayName: "Jonah", isBriefReady: true, createdAt: SERVER_NOW },
    { id: EXPLORE_MEETING, questionText: "Should we split work by strengths?", questionKind: "decision", state: "ended", otherDisplayName: "Priyanka", isBriefReady: true, createdAt: SERVER_NOW },
  ],
  pairs: [{ id: IDS.pair, otherDisplayName: null, createdAt: SERVER_NOW, expiresAt: SERVER_NOW }],
  serverNow: SERVER_NOW,
};
// The person's listing, and the same listing as Explore shows it to them.
const ITEMS = [
  { kind: "habit" as const, claim: "Plans before building", quote: "I can't start until I know what done looks like." },
  { kind: "value" as const, claim: "Says no to scope creep", quote: "Someone has to say no to features." },
];
const LISTING = MyListing.parse({ listingId: MINE, cardId: IDS.card, line: "Builds hackathon tools and likes a clear plan.", openToRomance: false, items: ITEMS, createdAt: SERVER_NOW });
const PROFILE = profileView({ listingId: MINE, displayName: "Ana", line: LISTING.line, openToRomance: false, items: ITEMS, friendship: "self" });
// The meeting Ana's agent was in through Explore.
const MEETINGS = ListedMeetingsView.parse({ meetings: [{ meetingId: EXPLORE_MEETING, otherDisplayName: "Priyanka", questionText: "Should we split work by strengths?", state: "ended", createdAt: SERVER_NOW }] });

// A 200 reply with this body.
function ok(body: unknown): GalleryReply {
  return { status: 200, body };
}

// The reads of /me. /api/directory/me is listed before /api/directory/:id, so it answers its own path.
function reads(listing: GalleryReply, meetings: unknown): GalleryStub[] {
  return [
    ...railStubs(railFriends(3)),
    { route: routes.directory.readMyListing, replies: listing },
    { route: routes.directory.listedMeetings, replies: ok(meetings) },
    { route: routes.social.readProfile, replies: ok(PROFILE) },
    { route: routes.people.readHome, replies: ok(HOME) },
  ];
}

// /me listed, its Meetings tab, and not listed.
export const views: readonly GalleryView[] = [
  { name: "me-listed", title: "Me, in Explore", pattern: ROUTE_PATTERNS.me, url: "/me", element: <MeScreen />, stubs: reads(ok(LISTING), MEETINGS) },
  {
    name: "me-meetings",
    title: "Me, the Meetings tab",
    pattern: ROUTE_PATTERNS.me,
    url: "/me",
    element: <AfterSteps steps={[{ press: "Meetings" }]}><MeScreen /></AfterSteps>,
    stubs: reads(ok(LISTING), MEETINGS),
  },
  { name: "me-unlisted", title: "Me, not in Explore yet", pattern: ROUTE_PATTERNS.me, url: "/me", element: <MeScreen />, stubs: reads({ status: 404, body: { code: "not_listed", message: "You are not in Explore yet." } }, { meetings: [] }) },
];
