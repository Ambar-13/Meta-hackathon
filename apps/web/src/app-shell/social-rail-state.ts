import type { Friend } from "@meet-first/contracts";
import { apiFetch, routes } from "./api-fetch.js";
import { usePolledView } from "./polled-view.js";

// How often the rail reads the friends and the friend requests again while a page is open, in ms (wave 7).
export const RAIL_POLL_MS = 30_000;
// The most friends the rail lists before it offers "See all friends".
export const RAIL_FRIENDS_MAX = 12;

// The words for a number of incoming friend requests: "1 request" or "2 requests".
export function requestCountWords(count: number): string {
  return count === 1 ? "1 request" : `${String(count)} requests`;
}

// The accessible name of the Friends link: "Friends" with no requests, else "Friends, 2 requests".
export function friendsLinkName(incomingCount: number): string {
  return incomingCount < 1 ? "Friends" : `Friends, ${requestCountWords(incomingCount)}`;
}

// What the rail shows: the friends once they have loaded (null while loading or after an error), and the incoming request count.
export type RailData = { friends: Friend[] | null; incomingCount: number };

// Reads GET /api/friends and GET /api/friend-requests when the page opens and every RAIL_POLL_MS; a failed read shows nothing and
// never blocks the page.
export function useRailData(): RailData {
  const friends = usePolledView(() => apiFetch(routes.directory.friends), { key: "rail-friends", intervalMs: RAIL_POLL_MS, keepPolling: () => true });
  const requests = usePolledView(() => apiFetch(routes.social.listFriendRequests), { key: "rail-requests", intervalMs: RAIL_POLL_MS, keepPolling: () => true });
  const friendList = friends.error === null ? (friends.value?.friends ?? null) : null;
  const incomingCount = requests.error === null ? (requests.value?.incoming.length ?? 0) : 0;
  return { friends: friendList, incomingCount };
}
