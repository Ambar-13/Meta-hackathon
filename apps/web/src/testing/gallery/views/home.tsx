import type { HomeView } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { HomeScreen } from "../../../screens/home/index.js";
import { IDS, SERVER_NOW } from "../../fixtures.js";
import { FOREVER_MS, type GalleryReply } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// Home at each stage of a person's first run, from no notes to a brief, plus loading and no session.

const REVIEWED = { id: IDS.source, namesPassDone: true, namesReviewed: true };
const CARD = {
  id: IDS.card,
  state: "approved" as const,
  itemCount: 6,
  items: [
    {
      kind: "habit" as const,
      claim: "Plans before building",
      quote: "I can't start until I know what done looks like.",
    },
    {
      kind: "boundary" as const,
      claim: "Done by 9 pm",
      quote: "After nine I am no use to anyone.",
    },
    {
      kind: "preference" as const,
      claim: "Would rather not pitch",
      quote: "Please don't make me present.",
    },
  ],
};
const YESTERDAY = "2026-10-26T15:40:00.000Z";

// A home view for Mira, with the given fields replaced.
function home(overrides: Partial<HomeView>): HomeView {
  return {
    displayName: "Mira",
    source: null,
    card: null,
    meetings: [],
    pairs: [],
    serverNow: SERVER_NOW,
    ...overrides,
  };
}

// One home view on the home route with one reply.
function homeAt(slot: { name: string; title: string; reply: GalleryReply }): GalleryView {
  return {
    name: slot.name,
    title: slot.title,
    pattern: ROUTE_PATTERNS.home,
    url: APP_PATHS.home,
    element: <HomeScreen />,
    stubs: [{ route: routes.people.readHome, replies: slot.reply }],
  };
}

// Home: new, names to check, card being written, card to approve, ready to meet, a meeting under way, a brief ready, loading, no session.
export const views: readonly GalleryView[] = [
  homeAt({
    name: "home-new",
    title: "Home, a brand new person",
    reply: { status: 200, body: home({}) },
  }),
  homeAt({
    name: "home-names",
    title: "Home, names to check",
    reply: {
      status: 200,
      body: home({ source: { id: IDS.source, namesPassDone: true, namesReviewed: false } }),
    },
  }),
  homeAt({
    name: "home-building",
    title: "Home, the card being written",
    reply: {
      status: 200,
      body: home({
        source: REVIEWED,
        card: { ...CARD, state: "building", itemCount: 0, items: [] },
      }),
    },
  }),
  homeAt({
    name: "home-approve",
    title: "Home, a card to approve",
    reply: { status: 200, body: home({ source: REVIEWED, card: { ...CARD, state: "ready" } }) },
  }),
  homeAt({
    name: "home-meet",
    title: "Home, ready to meet someone",
    reply: { status: 200, body: home({ source: REVIEWED, card: CARD }) },
  }),
  homeAt({
    name: "home-live",
    title: "Home, a meeting under way",
    reply: {
      status: 200,
      body: home({
        source: REVIEWED,
        card: CARD,
        meetings: [
          {
            id: IDS.meeting,
            questionText: "Where could each of us help the other most?",
            questionKind: "help",
            state: "running",
            otherDisplayName: "Ama",
            isBriefReady: false,
            createdAt: SERVER_NOW,
          },
        ],
      }),
    },
  }),
  homeAt({
    name: "home-brief",
    title: "Home, a brief ready, an open invite and past meetings",
    reply: {
      status: 200,
      body: home({
        source: REVIEWED,
        card: CARD,
        meetings: [
          {
            id: IDS.meeting,
            questionText: "Would we enjoy a 10-day hackathon together?",
            questionKind: "get_along",
            state: "ended",
            otherDisplayName: "Jonah",
            isBriefReady: true,
            createdAt: SERVER_NOW,
          },
          {
            id: "00000000-0000-4000-8000-000000000202",
            questionText: "If I build and you sell, would we close that deal tomorrow?",
            questionKind: "deal",
            state: "ended",
            otherDisplayName: "Sam",
            isBriefReady: true,
            createdAt: YESTERDAY,
          },
        ],
        pairs: [
          {
            id: IDS.pair,
            otherDisplayName: null,
            createdAt: SERVER_NOW,
            expiresAt: "2026-10-28T10:00:00.000Z",
          },
        ],
      }),
    },
  }),
  homeAt({
    name: "home-loading",
    title: "Home, loading",
    reply: { status: 200, body: home({}), delayMs: FOREVER_MS },
  }),
  homeAt({
    name: "home-signed-out",
    title: "Home, no session",
    reply: {
      status: 401,
      body: { code: "session_missing", message: "Sign in again to see this page." },
    },
  }),
];
