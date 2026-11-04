import { apiFetch, routes } from "./api-fetch.js";
import { usePolledView } from "./polled-view.js";

// How often the rail reads the friend requests again while a page is open, in ms.
export const RAIL_POLL_MS = 30_000;

// The words for a number of incoming friend requests: "1 request" or "2 requests".
export function requestCountWords(count: number): string {
  return count === 1 ? "1 request" : `${String(count)} requests`;
}

// The accessible name of the Friends link: "Friends" with no requests, else "Friends, 2 requests".
export function friendsLinkName(incomingCount: number): string {
  return incomingCount < 1 ? "Friends" : `Friends, ${requestCountWords(incomingCount)}`;
}

// What the rail shows: the number of friend requests waiting for an answer, as a count on the Friends icon.
export type RailData = { incomingCount: number };

// Reads GET /api/friend-requests when the page opens and every RAIL_POLL_MS; a failed read shows no count and never blocks the page.
// The friends themselves are listed on the home page, in its right-hand column, as Instagram lists suggestions there.
export function useRailData(): RailData {
  const requests = usePolledView(() => apiFetch(routes.social.listFriendRequests), {
    key: "rail-requests",
    intervalMs: RAIL_POLL_MS,
    keepPolling: () => true,
  });
  const incomingCount = requests.error === null ? (requests.value?.incoming.length ?? 0) : 0;
  return { incomingCount };
}
