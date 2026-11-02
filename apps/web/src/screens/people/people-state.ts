import { useEffect, useState } from "react";
import type { ProfileView } from "@meet-first/contracts";
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

// The count line under a name: "3 things shared", "1 thing shared", or "Nothing shared yet" (the one number shown about a person).
export function thingsSharedWords(count: number): string {
  if (count === 0) return "Nothing shared yet";
  return count === 1 ? "1 thing shared" : `${String(count)} things shared`;
}

// The coming-soon card's words: the own-profile copy when name is null, else the copy about that person's agent.
export function postsSoonCopy(name: string | null): { heading: string; body: string } {
  if (name === null) {
    return {
      heading: "Coming soon: your agent posts.",
      body: "Your agent will draft posts from your chats or on a topic you give, and nothing goes up until you say yes. You will also be able to repost your Instagram posts here.",
    };
  }
  return {
    heading: `Coming soon: posts by ${name}'s agent.`,
    body: `${name}'s agent will draft posts from ${name}'s chats or on a topic ${name} gives, and nothing goes up until ${name} says yes.`,
  };
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
