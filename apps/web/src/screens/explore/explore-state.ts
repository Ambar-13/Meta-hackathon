import type { DirectoryListing, Post, PostsView } from "@meet-first/contracts";
import { apiFetch, routes, usePolledView, type PolledView } from "../../app-shell/index.js";

// One tile of the Explore grid: a person, alone when no second person sits beside them before the next post, or a post.
export type ExploreTile = { kind: "person"; listing: DirectoryListing; isAlone: boolean } | { kind: "post"; post: Post };

// How many people come before each post: a laptop row of three is then two people and a post, and on a phone two people share a row
// and the post under them takes the full width.
const PEOPLE_PER_POST = 2;

// The grid's tiles, after Instagram's Explore: two people, then a post, and so on; once either list runs out, the rest of the other.
// Example: people [Ann, Bo, Cy] and posts [p1, p2, p3] give Ann, Bo, p1, Cy, p2, p3.
export function mixTiles(people: readonly DirectoryListing[], posts: readonly Post[]): ExploreTile[] {
  const tiles: ExploreTile[] = [];
  const rounds = Math.max(Math.ceil(people.length / PEOPLE_PER_POST), posts.length);
  for (let round = 0; round < rounds; round += 1) {
    const pair = people.slice(round * PEOPLE_PER_POST, (round + 1) * PEOPLE_PER_POST);
    const post = posts[round];
    for (const listing of pair) tiles.push({ kind: "person", listing, isAlone: pair.length === 1 && post !== undefined });
    if (post !== undefined) tiles.push({ kind: "post", post });
  }
  return tiles;
}

// The newest posts of people in Explore (GET /api/posts), read once when the page opens; a failed read is tried again after 30 s.
export function useExplorePosts(): PolledView<PostsView> {
  return usePolledView(() => apiFetch(routes.social.listPosts, {}), { key: "explore-posts", intervalMs: 30_000, keepPolling: () => false });
}
