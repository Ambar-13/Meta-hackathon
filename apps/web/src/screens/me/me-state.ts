import { useState } from "react";
import { LISTING_LINE_MAX_CHARS, type MyListing } from "@meet-first/contracts";
import { apiFetch, asApiError, routes, type ApiError } from "../../app-shell/index.js";

// The sentence for a line outside 1 to 140 characters, in the card page's words, so both places say the same.
export const LINE_REFUSAL = "Write a line of 1 to 140 characters about yourself.";

// Where a join or a save of the listing stands.
export type ListingSaveState = { kind: "idle" } | { kind: "sending" } | { kind: "saved" } | { kind: "refused"; sentence: string } | { kind: "failed"; error: ApiError };
// What a join or a save sends: the approved card, the line and the dating switch (ListingUpsert).
export type ListingInput = { cardId: string; line: string; openToRomance: boolean };

// The refusal for a line before any request, or null when the trimmed line has 1 to 140 characters.
export function lineRefusal(line: string): string | null {
  const trimmed = line.trim();
  return trimmed.length < 1 || trimmed.length > LISTING_LINE_MAX_CHARS ? LINE_REFUSAL : null;
}

// Joins Explore or saves the listing with PUT /api/directory/me, then hands the new listing to onSaved.
export function useListingSave(onSaved: (listing: MyListing) => void): { state: ListingSaveState; save: (input: ListingInput) => Promise<void> } {
  const [state, setState] = useState<ListingSaveState>({ kind: "idle" });
  const save = async (input: ListingInput): Promise<void> => {
    const refusal = lineRefusal(input.line);
    if (refusal !== null) {
      setState({ kind: "refused", sentence: refusal });
      return;
    }
    setState({ kind: "sending" });
    try {
      const listing = await apiFetch(routes.directory.upsertMyListing, { body: { cardId: input.cardId, line: input.line.trim(), openToRomance: input.openToRomance } });
      setState({ kind: "saved" });
      onSaved(listing);
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return { state, save };
}
