import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedCursor, FeedScope, Post } from "@meet-first/contracts";
import { apiFetch, asApiError, routes, type ApiError } from "../../app-shell/index.js";

// Which part of the feed loads next: your friends' posts and your own, then everyone else's, then nothing, at the end.
export type FeedPart = FeedScope | "end";

// Home's endless, honest feed (3 Nov 2026, Ambar chose "Endless and honest"): your friends' posts and your own as they load, everyone
// else's after them, which part loads next, whether a page is on its way, the last error, whether the first page has answered, and the
// two things a reader does to it: ask for the next page, and take away a post they deleted.
export type EndlessFeed = {
  friends: readonly Post[];
  others: readonly Post[];
  part: FeedPart;
  isLoading: boolean;
  error: ApiError | null;
  hasLoaded: boolean;
  loadMore: () => void;
  remove: (postId: string) => void;
};

// What the feed holds between pages.
type FeedState = { friends: Post[]; others: Post[]; part: FeedPart; cursor: FeedCursor | null; isLoading: boolean; error: ApiError | null; hasLoaded: boolean };

// The feed before its first page.
const START: FeedState = { friends: [], others: [], part: "friends", cursor: null, isLoading: false, error: null, hasLoaded: false };

// The query of the next page: the part, and where it starts when it is not the part's first page.
function queryOf(part: FeedScope, cursor: FeedCursor | null): Record<string, string> {
  return cursor === null ? { scope: part } : { scope: part, before: cursor.before, beforeId: cursor.beforeId };
}

// The state after one page of a part: its posts added, and, after its last page, the next part from its start.
function withPage(state: FeedState, part: FeedScope, page: { posts: Post[]; next: FeedCursor | null }): FeedState {
  const lists = part === "friends" ? { friends: [...state.friends, ...page.posts], others: state.others } : { friends: state.friends, others: [...state.others, ...page.posts] };
  const after: FeedPart = part === "friends" ? "others" : "end";
  return { ...lists, part: page.next === null ? after : part, cursor: page.next, isLoading: false, error: null, hasLoaded: true };
}

// Reads Home's feed a page at a time (GET /api/feed): the first page of your friends' posts when Home opens, and each next page when
// loadMore runs, which the page calls as the reader nears the end. When your friends' posts run out it goes on with everyone else's,
// at once when there were none of your friends' at all, so the feed never opens empty. A failed page keeps what loaded and can be asked
// again.
export function useEndlessFeed(): EndlessFeed {
  const [state, setState] = useState<FeedState>(START);
  const latest = useRef(state);
  latest.current = state;
  const loadMore = useCallback((): void => {
    const now = latest.current;
    if (now.isLoading || now.part === "end") return;
    const part = now.part;
    const loading = { ...now, isLoading: true, error: null };
    latest.current = loading;
    setState(loading);
    apiFetch(routes.social.listFeed, { query: queryOf(part, now.cursor) }).then(
      (page) => {
        const next = withPage(latest.current, part, page);
        latest.current = next;
        setState(next);
      },
      (thrown: unknown) => {
        const failed = { ...latest.current, isLoading: false, error: asApiError(thrown), hasLoaded: true };
        latest.current = failed;
        setState(failed);
      },
    );
  }, []);
  useEffect(() => {
    loadMore();
  }, [loadMore]);
  useEffect(() => {
    if (state.part === "others" && state.friends.length === 0 && state.others.length === 0 && !state.isLoading && state.error === null) loadMore();
  }, [state, loadMore]);
  const remove = (postId: string): void => {
    setState((now) => ({ ...now, friends: now.friends.filter((post) => post.postId !== postId), others: now.others.filter((post) => post.postId !== postId) }));
  };
  return { friends: state.friends, others: state.others, part: state.part, isLoading: state.isLoading, error: state.error, hasLoaded: state.hasLoaded, loadMore, remove };
}
