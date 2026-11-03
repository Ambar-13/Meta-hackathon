import type { MeetingView } from "@meet-first/contracts";
import { z } from "zod";

// A meeting side letter, "a" or "b", as contracts writes it.
export type Side = MeetingView["members"][number]["side"];

// Every client path the app links to; screens build links with these, never with string literals. As in
// Instagram, home is the feed and the signed-in start, search finds people and shows the photos, and meety is the chat with Meety;
// explore and directory lead to search; create shares a post or a story; privacy says what Meety keeps.
export const APP_PATHS = {
  welcome: "/", upload: "/upload", pair: "/pair", join: "/join", claim: "/claim", settings: "/settings",
  namesReview: (sourceId: string) => `/sources/${sourceId}/names`,
  card: (cardId: string) => `/cards/${cardId}`,
  quiz: (quizId: string) => `/quizzes/${quizId}`,
  lobby: (pairId: string) => `/pairs/${pairId}`,
  meeting: (meetingId: string) => `/meetings/${meetingId}`,
  brief: (meetingId: string) => `/meetings/${meetingId}/brief`,
  comic: (meetingId: string) => `/meetings/${meetingId}/comic`,
  consent: (meetingId: string) => `/meetings/${meetingId}/share`,
  sharePage: (slug: string) => `/share/${slug}`,
  directory: "/directory", help: "/help", friends: "/friends",
  ask: (askId: string) => `/asks/${askId}`,
  home: "/home",
  explore: "/explore", me: "/me",
  person: (listingId: string) => `/people/${listingId}`,
  meety: "/meety", search: "/search", create: "/create", privacy: "/privacy", terms: "/terms", cookies: "/cookies",
} as const;

// The route patterns, with the keys and parameter names of APP_PATHS, in the same order.
export const ROUTE_PATTERNS = {
  welcome: "/", upload: "/upload", pair: "/pair", join: "/join", claim: "/claim", settings: "/settings",
  namesReview: "/sources/:sourceId/names", card: "/cards/:cardId", quiz: "/quizzes/:quizId", lobby: "/pairs/:pairId",
  meeting: "/meetings/:meetingId", brief: "/meetings/:meetingId/brief", comic: "/meetings/:meetingId/comic",
  consent: "/meetings/:meetingId/share", sharePage: "/share/:slug",
  directory: "/directory", help: "/help", friends: "/friends", ask: "/asks/:askId", home: "/home",
  explore: "/explore", me: "/me", person: "/people/:listingId",
  meety: "/meety", search: "/search", create: "/create", privacy: "/privacy", terms: "/terms", cookies: "/cookies",
} as const;

// The query name that carries the approved card a meeting is created with, so a reload keeps it (no contract field carries it).
export const CARD_QUERY = "card";
// The query name that carries this browser's side in a meeting, so a reload keeps it (MeetingView has no viewer side).
export const SIDE_QUERY = "side";

// The query name that carries words for the chat composer, so a link can open the chat with a message started.
export const DRAFT_QUERY = "draft";

// The query name that opens a profile on one of its tabs, so a post in the feed can open its person's Posts tab.
export const PROFILE_TAB_QUERY = "tab";

// The query name that opens Create on a story rather than a post, so Your story can open it ready for a story.
const CREATE_KIND_QUERY = "kind";

// Create, ready for a post or for a story.
export function createPath(kind: "post" | "story"): string {
  return kind === "post" ? APP_PATHS.create : `${APP_PATHS.create}?${CREATE_KIND_QUERY}=story`;
}

// What Create opens ready for: a story when the address says so, else a post.
export function readCreateKind(search: string): "post" | "story" {
  return new URLSearchParams(search).get(CREATE_KIND_QUERY) === "story" ? "story" : "post";
}

// A profile opened on its Posts tab.
export function personPostsPath(listingId: string): string {
  return `${APP_PATHS.person(listingId)}?${PROFILE_TAB_QUERY}=posts`;
}

// The tab a profile's address asks for: posts when it says so, else about.
export function readProfileTab(search: string): "about" | "posts" {
  return new URLSearchParams(search).get(PROFILE_TAB_QUERY) === "posts" ? "posts" : "about";
}

// The chat with Meety, with these words waiting in its composer.
export function chatPathWithDraft(text: string): string {
  return `${APP_PATHS.meety}?${DRAFT_QUERY}=${encodeURIComponent(text)}`;
}

// The pair screen for an approved card.
export function pairPathWithCard(cardId: string): string {
  return `${APP_PATHS.pair}?${CARD_QUERY}=${encodeURIComponent(cardId)}`;
}

// The lobby, carrying the approved card when this browser knows it.
export function lobbyPathWithCard(pairId: string, cardId: string | null): string {
  if (cardId === null) return APP_PATHS.lobby(pairId);
  return `${APP_PATHS.lobby(pairId)}?${CARD_QUERY}=${encodeURIComponent(cardId)}`;
}

// The meeting screen, carrying this browser's side when it is known.
export function meetingPathWithSide(meetingId: string, side: Side | null): string {
  if (side === null) return APP_PATHS.meeting(meetingId);
  return `${APP_PATHS.meeting(meetingId)}?${SIDE_QUERY}=${side}`;
}

// The card id from a query string, or null when it is absent or not a uuid.
export function readCardQuery(search: string): string | null {
  const value = new URLSearchParams(search).get(CARD_QUERY);
  return z.string().uuid().safeParse(value).success && value !== null ? value : null;
}

// This browser's side from a query string, or null.
export function readSideQuery(search: string): Side | null {
  const value = new URLSearchParams(search).get(SIDE_QUERY);
  return value === "a" || value === "b" ? value : null;
}

// The 32 lower-case hex token after the #, as invite and transfer links carry it, or null.
export function readFragmentToken(hash: string): string | null {
  const match = /^#?([0-9a-f]{32})$/.exec(hash);
  return match?.[1] ?? null;
}
