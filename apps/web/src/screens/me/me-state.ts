import { useState } from "react";
import { DISPLAY_NAME_MAX_CHARS, LISTING_LINE_MAX_CHARS, type MyListing, type MyPostsView } from "@meet-first/contracts";
import { apiFetch, apiPhotoUpload, asApiError, routes, usePolledView, type ApiError, type PolledView } from "../../app-shell/index.js";
import { squareJpeg } from "./photo-file.js";

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

// The sentences of Edit profile: a file that is not a picture, a name outside 1 to 80 characters, and each change done.
const EDIT_SENTENCES = {
  notPicture: "That file is not a photo this browser can open. Try a JPEG or PNG.",
  name: `Write a name of 1 to ${String(DISPLAY_NAME_MAX_CHARS)} characters.`,
  photoUp: "Your new photo is up.",
  photoGone: "Your photo is gone.",
  nameSaved: "Saved. Everyone sees your new name now.",
} as const;

// Where a change to the photo or the name stands: sending, done with its sentence, refused before any request, or failed.
export type EditState = { kind: "idle" } | { kind: "sending" } | { kind: "done"; sentence: string } | { kind: "refused"; sentence: string } | { kind: "failed"; error: ApiError };
// What Edit profile does: put up, replace or take down your photo, and change your name.
export type ProfileEditHook = { photo: EditState; name: EditState; putPhoto: (file: Blob) => Promise<void>; removePhoto: () => Promise<void>; saveName: (name: string) => Promise<void> };

// Edit profile's changes: a photo drawn in the browser as a square JPEG and sent with PUT /api/people/me/photo, its removal with DELETE,
// and a new name with PUT /api/people/me/name; onChanged runs after each change, so the page reads you again.
export function useProfileEdit(onChanged: () => void): ProfileEditHook {
  const [photo, setPhoto] = useState<EditState>({ kind: "idle" });
  const [name, setName] = useState<EditState>({ kind: "idle" });
  const putPhoto = async (file: Blob): Promise<void> => {
    setPhoto({ kind: "sending" });
    let jpeg: Blob;
    try {
      jpeg = await squareJpeg(file);
    } catch {
      setPhoto({ kind: "refused", sentence: EDIT_SENTENCES.notPicture });
      return;
    }
    try {
      await apiPhotoUpload(jpeg);
      setPhoto({ kind: "done", sentence: EDIT_SENTENCES.photoUp });
      onChanged();
    } catch (thrown: unknown) {
      setPhoto({ kind: "failed", error: asApiError(thrown) });
    }
  };
  const removePhoto = async (): Promise<void> => {
    setPhoto({ kind: "sending" });
    try {
      await apiFetch(routes.people.removePhoto, {});
      setPhoto({ kind: "done", sentence: EDIT_SENTENCES.photoGone });
      onChanged();
    } catch (thrown: unknown) {
      setPhoto({ kind: "failed", error: asApiError(thrown) });
    }
  };
  const saveName = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.length > DISPLAY_NAME_MAX_CHARS) {
      setName({ kind: "refused", sentence: EDIT_SENTENCES.name });
      return;
    }
    setName({ kind: "sending" });
    try {
      await apiFetch(routes.people.updateName, { body: { displayName: trimmed } });
      setName({ kind: "done", sentence: EDIT_SENTENCES.nameSaved });
      onChanged();
    } catch (thrown: unknown) {
      setName({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return { photo, name, putPhoto, removePhoto, saveName };
}

// Your own posts (GET /api/people/me/posts), read once when /me opens, whether or not you are in Explore; a failed read is tried again
// after 30 s.
export function useMyPosts(): PolledView<MyPostsView> {
  return usePolledView(() => apiFetch(routes.social.listMyPosts, {}), { key: "my-posts", intervalMs: 30_000, keepPolling: () => false });
}
