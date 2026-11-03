import { useEffect, useState } from "react";
import type { PostsView, ProfileView } from "@meet-first/contracts";
import { apiFetch, asApiError, readApprovedCard, readCardQuery, routes, usePolledView, type ApiError, type PolledView } from "../../app-shell/index.js";
import { readListingOrNull } from "../card/index.js";

// Where the last friend request action stands: nothing sent, one on its way, or refused with the api's own sentence.
export type ProfileActionState = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; error: ApiError };
// One profile with its friend request actions; each action reads the profile again once the api has answered.
export type ProfileModel = {
  profile: PolledView<ProfileView>;
  action: ProfileActionState;
  addFriend: () => Promise<void>;
  accept: (requestId: string) => Promise<void>;
  decline: (requestId: string) => Promise<void>;
};

// The coming-soon card's words: the own-profile copy when name is null, else the copy about that person's agent.
export function postsSoonCopy(name: string | null): { heading: string; body: string } {
  if (name === null) {
    return {
      heading: "Coming soon: your Meety posts.",
      body: "Your Meety will draft posts from your chats or on a topic you give, and nothing goes up until you say yes. You will also be able to repost your Instagram posts here.",
    };
  }
  return {
    heading: `Coming soon: posts by ${name}'s Meety.`,
    body: `${name}'s Meety will draft posts from ${name}'s chats or on a topic ${name} gives, and nothing goes up until ${name} says yes.`,
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// How long ago a post went up, in words: "A moment ago", "5 minutes ago", "3 hours ago", "2 days ago", then the day, as "Oct 28".
// A time ahead of this clock reads as a moment ago.
export function postAgeWords(createdAt: string, now: Date): string {
  const age = now.getTime() - new Date(createdAt).getTime();
  const count = (unit: number, word: string): string => {
    const n = Math.floor(age / unit);
    return `${String(n)} ${word}${n === 1 ? "" : "s"} ago`;
  };
  if (age < MINUTE_MS) return "A moment ago";
  if (age < HOUR_MS) return count(MINUTE_MS, "minute");
  if (age < DAY_MS) return count(HOUR_MS, "hour");
  if (age < 7 * DAY_MS) return count(DAY_MS, "day");
  return new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// One profile's posts (GET /api/directory/:id/posts), read once when the profile opens; a failed read is tried again after 30 s.
export function useListingPosts(listingId: string): PolledView<PostsView> {
  return usePolledView(() => apiFetch(routes.social.listListingPosts, { params: { id: listingId } }), { key: `profile-posts-${listingId}`, intervalMs: 30_000, keepPolling: () => false });
}

// Reads one profile (GET /api/directory/:id) and sends, accepts or declines the friend request on it.
export function useProfile(listingId: string): ProfileModel {
  const profile = usePolledView(() => apiFetch(routes.social.readProfile, { params: { id: listingId } }), { key: `profile-${listingId}`, intervalMs: 30_000, keepPolling: () => false });
  const [action, setAction] = useState<ProfileActionState>({ kind: "idle" });
  const run = async (send: () => Promise<unknown>): Promise<void> => {
    setAction({ kind: "sending" });
    try {
      await send();
      setAction({ kind: "idle" });
      profile.reload();
    } catch (thrown: unknown) {
      setAction({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return {
    profile,
    action,
    addFriend: () => run(() => apiFetch(routes.social.sendFriendRequest, { body: { listingId } })),
    accept: (requestId) => run(() => apiFetch(routes.social.acceptFriendRequest, { params: { id: requestId } })),
    decline: (requestId) => run(() => apiFetch(routes.social.declineFriendRequest, { params: { id: requestId } })),
  };
}

// The card a meeting with a friend's agent speaks from: the card in the address, else the card this tab approved, else the card of
// the person's own listing, read only when isNeeded. Null while unknown; a failed read leaves it null.
export function useMeetingCard(search: string, isNeeded: boolean): string | null {
  const known = readCardQuery(search) ?? readApprovedCard();
  const [listedCardId, setListedCardId] = useState<string | null>(null);
  const shouldRead = isNeeded && known === null;
  useEffect(() => {
    if (!shouldRead) return undefined;
    let isActive = true;
    readListingOrNull().then(
      (listing) => {
        if (isActive) setListedCardId(listing?.cardId ?? null);
      },
      () => undefined,
    );
    return () => {
      isActive = false;
    };
  }, [shouldRead]);
  return known ?? listedCardId;
}
