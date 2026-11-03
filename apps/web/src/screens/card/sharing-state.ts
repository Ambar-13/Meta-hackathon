import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { LISTING_LINE_MAX_CHARS, type CardSharing, type ListingUpsert, type MyListing } from "@meet-first/contracts";
import { apiFetch, ApiError, APP_PATHS, asApiError, CARD_QUERY, routes } from "../../app-shell/index.js";

// The code GET /api/directory/me answers with when the person has no listing (design section 6). It means not listed, not a failure.
export const NOT_LISTED_CODE = "not_listed";
// The sentence for a save with the directory switch on and a line that is empty or longer than LISTING_LINE_MAX_CHARS [confirm].
export const LINE_REFUSAL = "Write a line of 1 to 140 characters about yourself.";
// The sentence for a save with the directory switch on and no public item, which the server would refuse too [confirm].
export const NO_PUBLIC_ITEM_REFUSAL = "Mark at least one item public to join Explore.";

// What the server holds: this card's sharing settings, and the person's listing, which may be on another card, or null.
export type SavedSharing = { sharing: CardSharing; listing: MyListing | null };
// What the person has set on the screen and not saved yet.
export type SharingDraft = { friendsCanAsk: boolean; publicPositions: ReadonlySet<number>; isListed: boolean; line: string; openToRomance: boolean };
// The calls of one save, in this order: leave the directory when asked, the card's sharing, then the listing when it changed.
export type SharingSendPlan = { kind: "send"; isLeavingFirst: boolean; sharing: CardSharing; listing: ListingUpsert | null };
// One save, decided before any request: sent as planned, or refused with a sentence and nothing sent.
export type SharingSavePlan = SharingSendPlan | { kind: "refused"; sentence: string };
// The section's data: loading, failed with the error to show, or ready with what the server holds and the draft.
export type SharingLoad = { kind: "loading" } | { kind: "failed"; error: ApiError } | { kind: "ready"; saved: SavedSharing; draft: SharingDraft };
// Where the last save stands.
export type SharingStatus = { kind: "idle" } | { kind: "sending" } | { kind: "saved" } | { kind: "refused"; sentence: string } | { kind: "failed"; error: ApiError };
// What the Sharing section reads and calls.
export type SharingHook = {
  load: SharingLoad;
  status: SharingStatus;
  setFriendsCanAsk: (isOn: boolean) => void;
  togglePublic: (position: number) => void;
  setListed: (isOn: boolean) => void;
  setLine: (line: string) => void;
  setOpenToRomance: (isOn: boolean) => void;
  save: () => Promise<void>;
};

// The directory page carrying this card in its address, so the Meet buttons there speak from it (design section 7).
export function directoryPathWithCard(cardId: string): string {
  return `${APP_PATHS.directory}?${CARD_QUERY}=${encodeURIComponent(cardId)}`;
}

// True when the person's listing is on this card.
export function isListedWith(listing: MyListing | null, cardId: string): boolean {
  return listing !== null && listing.cardId === cardId;
}

// The person's listing, or null when GET /api/directory/me answers not_listed; any other failure is thrown on to the caller.
export async function readListingOrNull(): Promise<MyListing | null> {
  try {
    return await apiFetch(routes.directory.readMyListing);
  } catch (thrown: unknown) {
    const error = asApiError(thrown);
    if (error.code === NOT_LISTED_CODE) return null;
    throw error;
  }
}

// The draft a saved state opens with: each control as the server holds it, so every control is off when nothing is shared (design section 7).
export function draftFromSaved(saved: SavedSharing, cardId: string): SharingDraft {
  const isListedHere = isListedWith(saved.listing, cardId);
  return {
    friendsCanAsk: saved.sharing.friendsCanAsk,
    publicPositions: new Set(saved.sharing.publicPositions),
    isListed: isListedHere,
    line: saved.listing?.line ?? "",
    openToRomance: isListedHere && saved.listing?.openToRomance === true,
  };
}

// The refusal for a draft the directory would not take, or null when the draft may be sent.
function draftRefusal(draft: SharingDraft): string | null {
  if (!draft.isListed) return null;
  const lineLength = draft.line.trim().length;
  if (lineLength === 0 || lineLength > LISTING_LINE_MAX_CHARS) return LINE_REFUSAL;
  if (draft.publicPositions.size === 0) return NO_PUBLIC_ITEM_REFUSAL;
  return null;
}

// The listing body to send, or null when the switch is off or the listing on this card already has this line and dating switch.
function listingToSend(input: { cardId: string; listedHere: MyListing | null; draft: SharingDraft }): ListingUpsert | null {
  const { cardId, listedHere, draft } = input;
  if (!draft.isListed) return null;
  const line = draft.line.trim();
  const isUnchanged = listedHere !== null && listedHere.line === line && listedHere.openToRomance === draft.openToRomance;
  return isUnchanged ? null : { cardId, line, openToRomance: draft.openToRomance };
}

// Decides what one save sends before any request, so a refused draft sends nothing (design section 7, P2, P8).
export function planSharingSave(input: { cardId: string; saved: SavedSharing; draft: SharingDraft }): SharingSavePlan {
  const { cardId, saved, draft } = input;
  const refusal = draftRefusal(draft);
  if (refusal !== null) return { kind: "refused", sentence: refusal };
  const isListedHere = isListedWith(saved.listing, cardId);
  const publicPositions = [...draft.publicPositions].sort((first, second) => first - second);
  const listing = listingToSend({ cardId, listedHere: isListedHere ? saved.listing : null, draft });
  return { kind: "send", isLeavingFirst: isListedHere && !draft.isListed, sharing: { friendsCanAsk: draft.friendsCanAsk, publicPositions }, listing };
}

// Sends one planned save in order and returns what the server now holds. A failed call throws, so the calls after it are not sent.
export async function sendSharingSave(input: { cardId: string; saved: SavedSharing; plan: SharingSendPlan }): Promise<SavedSharing> {
  const { cardId, saved, plan } = input;
  if (plan.isLeavingFirst) await apiFetch(routes.directory.leave);
  const sharing = await apiFetch(routes.directory.updateSharing, { params: { id: cardId }, body: plan.sharing });
  let listing = plan.isLeavingFirst ? null : saved.listing;
  if (plan.listing !== null) listing = await apiFetch(routes.directory.upsertMyListing, { body: plan.listing });
  return { sharing, listing };
}

// A copy of the positions with one position added when absent, or removed when present.
function toggled(positions: ReadonlySet<number>, position: number): ReadonlySet<number> {
  const next = new Set(positions);
  if (next.has(position)) next.delete(position);
  else next.add(position);
  return next;
}

// Loads this card's sharing settings and the person's listing once per card.
function useSavedSharing(cardId: string): { load: SharingLoad; setLoad: Dispatch<SetStateAction<SharingLoad>> } {
  const [load, setLoad] = useState<SharingLoad>({ kind: "loading" });
  useEffect(() => {
    let isActive = true;
    Promise.all([apiFetch(routes.directory.readSharing, { params: { id: cardId } }), readListingOrNull()]).then(
      ([sharing, listing]) => {
        const saved = { sharing, listing };
        if (isActive) setLoad({ kind: "ready", saved, draft: draftFromSaved(saved, cardId) });
      },
      (thrown: unknown) => {
        if (isActive) setLoad({ kind: "failed", error: asApiError(thrown) });
      },
    );
    return () => {
      isActive = false;
    };
  }, [cardId]);
  return { load, setLoad };
}

// The Sharing section's state and actions for one approved card (design section 7, P1 to P3, P8).
export function useSharing(cardId: string): SharingHook {
  const { load, setLoad } = useSavedSharing(cardId);
  const [status, setStatus] = useState<SharingStatus>({ kind: "idle" });

  // A change clears the last saved or refused line, but never the sending state, so Save stays off while a save is out.
  const change = (update: (draft: SharingDraft) => SharingDraft): void => {
    setLoad((previous) => (previous.kind === "ready" ? { ...previous, draft: update(previous.draft) } : previous));
    setStatus((previous) => (previous.kind === "sending" ? previous : { kind: "idle" }));
  };

  const save = async (): Promise<void> => {
    if (load.kind !== "ready") return;
    const plan = planSharingSave({ cardId, saved: load.saved, draft: load.draft });
    if (plan.kind === "refused") {
      setStatus({ kind: "refused", sentence: plan.sentence });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const saved = await sendSharingSave({ cardId, saved: load.saved, plan });
      setLoad({ kind: "ready", saved, draft: draftFromSaved(saved, cardId) });
      setStatus({ kind: "saved" });
    } catch (thrown: unknown) {
      setStatus({ kind: "failed", error: asApiError(thrown) });
    }
  };

  return {
    load,
    status,
    save,
    setFriendsCanAsk: (isOn) => {
      change((draft) => ({ ...draft, friendsCanAsk: isOn }));
    },
    togglePublic: (position) => {
      change((draft) => ({ ...draft, publicPositions: toggled(draft.publicPositions, position) }));
    },
    setListed: (isOn) => {
      change((draft) => ({ ...draft, isListed: isOn, openToRomance: isOn && draft.openToRomance }));
    },
    setLine: (line) => {
      change((draft) => ({ ...draft, line }));
    },
    setOpenToRomance: (isOn) => {
      change((draft) => ({ ...draft, openToRomance: draft.isListed && isOn }));
    },
  };
}
