import type { MeetingView } from "@meet-first/contracts";
import { z } from "zod";

// A meeting side letter, "a" or "b", as contracts writes it.
export type Side = MeetingView["members"][number]["side"];

// Every client path the app links to; screens build links with these, never with string literals (seams S11).
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
} as const;

// The route patterns, with the keys and parameter names of APP_PATHS, in the same order (seams S11).
export const ROUTE_PATTERNS = {
  welcome: "/", upload: "/upload", pair: "/pair", join: "/join", claim: "/claim", settings: "/settings",
  namesReview: "/sources/:sourceId/names", card: "/cards/:cardId", quiz: "/quizzes/:quizId", lobby: "/pairs/:pairId",
  meeting: "/meetings/:meetingId", brief: "/meetings/:meetingId/brief", comic: "/meetings/:meetingId/comic",
  consent: "/meetings/:meetingId/share", sharePage: "/share/:slug",
  directory: "/directory", help: "/help", friends: "/friends", ask: "/asks/:askId", home: "/home",
  explore: "/explore", me: "/me", person: "/people/:listingId",
} as const;

// The query name that carries the approved card a meeting is created with, so a reload keeps it [confirm] (no contract field carries it).
export const CARD_QUERY = "card";
// The query name that carries this browser's side in a meeting, so a reload keeps it [confirm] (MeetingView has no viewer side).
export const SIDE_QUERY = "side";

// The query name that carries words for the chat composer, so a link can open the chat with a message started (wave 7).
export const DRAFT_QUERY = "draft";

// The query name that opens a profile on one of its tabs, so a post in Explore can open its person's Posts tab.
export const PROFILE_TAB_QUERY = "tab";

// A profile opened on its Posts tab.
export function personPostsPath(listingId: string): string {
  return `${APP_PATHS.person(listingId)}?${PROFILE_TAB_QUERY}=posts`;
}

// The tab a profile's address asks for: posts when it says so, else about.
export function readProfileTab(search: string): "about" | "posts" {
  return new URLSearchParams(search).get(PROFILE_TAB_QUERY) === "posts" ? "posts" : "about";
}

// The chat at /home with these words waiting in its composer.
export function chatPathWithDraft(text: string): string {
  return `${APP_PATHS.home}?${DRAFT_QUERY}=${encodeURIComponent(text)}`;
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
