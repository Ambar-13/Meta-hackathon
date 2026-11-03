import type { PostsView } from "@meet-first/contracts";
import { apiFetch, routes, usePolledView, type PolledView } from "../../app-shell/index.js";
import { useAdds, type AddsModel } from "../chat/index.js";

// How many posts come before the row of people to meet, as Instagram puts "Suggested for you" a little way into its feed.
const POSTS_BEFORE_PEOPLE = 2;

// Where the row of people goes among the posts: after the second post, or after the last when there are fewer.
// Example: 5 posts give 2, 1 post gives 1, no posts give 0.
export function peopleRowAt(postCount: number): number {
  return Math.min(POSTS_BEFORE_PEOPLE, postCount);
}

// The newest posts of people in Explore (GET /api/posts), read once when the page opens; a failed read is tried again after 30 s.
export function useExplorePosts(): PolledView<PostsView> {
  return usePolledView(() => apiFetch(routes.social.listPosts, {}), { key: "explore-posts", intervalMs: 30_000, keepPolling: () => false });
}

// Who among the people in Explore is already a friend, whose agent can be asked, and the Add friend requests sent from this page.
export type ExploreFriends = { isFriend: (listingId: string) => boolean; canAsk: (listingId: string) => boolean; adds: AddsModel };

// Reads the friends list once (GET /api/friends) and holds the Add friend buttons; adding a sample person, who accepts at once, reads
// the friends list again.
export function useExploreFriends(): ExploreFriends {
  const friends = usePolledView(() => apiFetch(routes.directory.friends, {}), { key: "explore-friends", intervalMs: 30_000, keepPolling: () => false });
  const adds = useAdds(friends.reload);
  const list = friends.value?.friends ?? [];
  const byListing = new Map(list.flatMap((friend) => (friend.listingId === null ? [] : [[friend.listingId, friend] as const])));
  return {
    isFriend: (listingId) => byListing.has(listingId) || adds.stateOf(listingId).kind === "friends",
    canAsk: (listingId) => byListing.get(listingId)?.canAsk === true,
    adds,
  };
}
