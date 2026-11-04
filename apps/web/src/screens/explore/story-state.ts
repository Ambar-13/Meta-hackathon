import { useState } from "react";
import type { Post, Story, StoriesView } from "@meet-first/contracts";
import {
  apiFetch,
  asApiError,
  routes,
  usePolledView,
  type ApiError,
  type PolledView,
} from "../../app-shell/index.js";

// The browser's own list of the stories this person has watched, so a ring stops showing as new; it never leaves the browser.
const SEEN_KEY = "meet-first-stories-seen";
// The most watched stories the list keeps, newest last; a story lasts a day, so older ones no longer matter.
const SEEN_MAX = 300;

// One person's stories as the row shows them: who they are, their stories oldest first, as Instagram plays them, and whether every one
// of them has been watched.
export type StoryGroup = {
  key: string;
  listingId: string | null;
  displayName: string;
  isSample: boolean;
  isMine: boolean;
  authorPhoto: string | null;
  stories: Story[];
  isSeen: boolean;
};

// The stories the browser remembers this person watched; an empty list when the browser keeps none or cannot be read.
export function readSeen(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

// Remembers one watched story, keeping the newest SEEN_MAX; a browser that keeps nothing forgets it.
export function rememberSeen(storyId: string): void {
  try {
    const kept = [...readSeen()].filter((id) => id !== storyId);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...kept, storyId].slice(-SEEN_MAX)));
  } catch {
    // A browser that keeps nothing shows every ring as new again; nothing else changes.
  }
}

// The stories by person, in the row's order: your own first, then people with a story you have not watched before people whose stories
// you have, friends first within each, and sample people after real ones. Each person's stories play oldest first.
// Example: your story, Maya (sample, new) and Jun (a friend, watched) give you, Maya, Jun when Jun's are watched.
export function storyGroups(
  stories: readonly Story[],
  isFriend: (listingId: string) => boolean,
  seen: ReadonlySet<string>,
): StoryGroup[] {
  const groups = new Map<string, StoryGroup>();
  for (const story of stories) {
    const key = story.isMine ? "mine" : (story.listingId ?? story.storyId);
    const group = groups.get(key) ?? {
      key,
      listingId: story.listingId,
      displayName: story.displayName,
      isSample: story.isSample,
      isMine: story.isMine,
      authorPhoto: story.authorPhoto,
      stories: [],
      isSeen: true,
    };
    group.stories.unshift(story);
    group.isSeen = group.isSeen && seen.has(story.storyId);
    groups.set(key, group);
  }
  const rank = (group: StoryGroup): number[] => [
    group.isMine ? 0 : 1,
    group.isSeen ? 1 : 0,
    group.isSample ? 1 : 0,
    group.listingId !== null && isFriend(group.listingId) ? 0 : 1,
  ];
  return [...groups.values()]
    .map((group, order) => ({ group, order }))
    .sort((a, b) => {
      const left = rank(a.group);
      const right = rank(b.group);
      const differs = left.findIndex((value, index) => value !== right[index]);
      return differs === -1 ? a.order - b.order : (left[differs] ?? 0) - (right[differs] ?? 0);
    })
    .map((entry) => entry.group);
}

// The stories that show now (GET /api/stories), read once when Home opens; a failed read is tried again after 30 s.
export function useStories(): PolledView<StoriesView> {
  return usePolledView(() => apiFetch(routes.social.listStories, {}), {
    key: "stories",
    intervalMs: 30_000,
    keepPolling: () => false,
  });
}

// Where a like stands for one post, as this page last set it: the server's word until the person taps the heart.
export type LikesModel = {
  isLiked: (post: Post) => boolean;
  toggle: (post: Post) => Promise<void>;
  error: ApiError | null;
};

// The hearts of the feed: a tap fills or empties the heart at once and sends PUT or DELETE /api/posts/:id/like; when the api refuses, the
// heart goes back and the error shows.
export function useLikes(): LikesModel {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [error, setError] = useState<ApiError | null>(null);
  const isLiked = (post: Post): boolean => overrides.get(post.postId) ?? post.isLiked === true;
  const set = (postId: string, value: boolean): void => {
    setOverrides((current) => new Map(current).set(postId, value));
  };
  const toggle = async (post: Post): Promise<void> => {
    const willLike = !isLiked(post);
    set(post.postId, willLike);
    setError(null);
    try {
      await apiFetch(willLike ? routes.social.likePost : routes.social.unlikePost, {
        params: { id: post.postId },
      });
    } catch (thrown: unknown) {
      set(post.postId, !willLike);
      setError(asApiError(thrown));
    }
  };
  return { isLiked, toggle, error };
}

// Deletes one of your own posts or stories (DELETE /api/posts/:id), then runs onDeleted so the page reads again.
export async function deleteShare(postId: string, onDeleted: () => void): Promise<void> {
  await apiFetch(routes.social.deletePost, { params: { id: postId } });
  onDeleted();
}
