import type { DirectoryListing, Post, PostsView, PublicItem } from "@meet-first/contracts";
import { apiFetch, routes, usePolledView, type PolledView } from "../../app-shell/index.js";
import { useAdds, type AddsModel } from "../chat/index.js";

// How many posts come before the row of people to meet, as Instagram puts "Suggested for you" a little way into its feed.
const POSTS_BEFORE_PEOPLE = 2;

// Where the row of people goes among the posts: after the second post, or after the last when there are fewer.
// Example: 5 posts give 2, 1 post gives 1, no posts give 0.
export function peopleRowAt(postCount: number): number {
  return Math.min(POSTS_BEFORE_PEOPLE, postCount);
}

// Words too common to tie a post to one of its writer's items.
const COMMON_WORDS: ReadonlySet<string> = new Set([
  "about", "after", "again", "also", "before", "being", "been", "does", "done", "every", "from", "have", "here", "into", "just", "like", "more", "most",
  "much", "only", "over", "some", "than", "that", "their", "them", "then", "there", "they", "this", "those", "very", "what", "when", "where", "which",
  "while", "will", "with", "would", "your", "yours",
]);

// The words of a text that can tie it to another: lower case, four letters or more, not common, a plural s taken off, and none of leaveOut.
// Example: "Draw the three screens" gives draw, three, screen.
export function keyWords(text: string, leaveOut: ReadonlySet<string> = new Set()): Set<string> {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const kept = words.filter((word) => word.length >= 4 && !COMMON_WORDS.has(word)).map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word));
  return new Set(kept.filter((word) => !leaveOut.has(word)));
}

// The public item of a post's writer that shares the most words with the post, for the line under it: the first such item on a tie,
// and null when no item shares a word or the writer is not on the loaded pages. The writer's own name never counts as a shared word.
// Example: Jun's post "Looking for a team that needs someone to own the hardware" picks "Will own the hardware on a team".
export function noteItemFor(post: Post, listing: DirectoryListing | undefined): PublicItem | null {
  if (listing === undefined) return null;
  const name = keyWords(post.displayName);
  const postWords = keyWords(post.text, name);
  let best: PublicItem | null = null;
  let bestScore = 0;
  for (const item of listing.items) {
    const score = [...keyWords(`${item.claim} ${item.quote}`, name)].filter((word) => postWords.has(word)).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

// The people of the row of faces: everyone on the loaded pages of Explore, friends first, each group in its order on the page.
// Example: Ravi, Mira and Jun, with Jun a friend, give Jun, Ravi, Mira.
export function storyPeople(listings: readonly DirectoryListing[], isFriend: (listingId: string) => boolean): DirectoryListing[] {
  return [...listings.filter((listing) => isFriend(listing.listingId)), ...listings.filter((listing) => !isFriend(listing.listingId))];
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
