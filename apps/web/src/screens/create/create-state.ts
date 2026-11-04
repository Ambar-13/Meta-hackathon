import { useEffect, useRef, useState } from "react";
import { POST_TEXT_MAX_CHARS, type PostCreated, type PostKind } from "@meet-first/contracts";
import { apiFetch, asApiError, routes, type ApiError } from "../../app-shell/index.js";
import { readListingOrNull } from "../card/index.js";
import { base64Of, PhotoFileError, postJpeg, storyJpeg } from "../me/index.js";

// The sentences of Create: a file that is not a picture, one too large even when drawn smaller, and
// a share with nothing in it.
const CREATE_SENTENCES = {
  notPicture: "That file is not a photo this browser can open. Try a JPEG or PNG.",
  tooLarge: "That photo is too large to share. Try another one.",
  empty: "Add a photo or some words first.",
} as const;

// The photo chosen for a share: the file it came from, so a switch between post and story draws it
// again, the JPEG drawn for the current kind, and the address that shows that JPEG.
export type ChosenPhoto = { file: Blob; jpeg: Blob; url: string };
// Where a share stands: drawing the photo, sending, refused before any request with its sentence,
// or failed with the api's error.
export type ShareState =
  | { kind: "idle" }
  | { kind: "drawing" }
  | { kind: "sending" }
  | { kind: "refused"; sentence: string }
  | { kind: "failed"; error: ApiError };
// Whether the person is in Explore, which decides who sees a post: unknown while it is read, and
// unknown when the read fails.
export type Listed = "unknown" | "listed" | "not-listed";

// What Create holds and does: the kind, the photo, the words, where the share stands, and whether
// the person is in Explore.
export type CreateModel = {
  kind: PostKind;
  setKind: (kind: PostKind) => void;
  photo: ChosenPhoto | null;
  pickPhoto: (file: Blob) => Promise<void>;
  removePhoto: () => void;
  text: string;
  setText: (text: string) => void;
  state: ShareState;
  listed: Listed;
  share: () => Promise<PostCreated | null>;
};

// The JPEG of a photo for one kind: a square for a post, the whole picture for a story.
function drawFor(kind: PostKind, file: Blob): Promise<Blob> {
  return kind === "post" ? postJpeg(file) : storyJpeg(file);
}

// The sentence for a photo that could not be drawn.
function photoSentence(error: PhotoFileError): string {
  return error.message === "too large" ? CREATE_SENTENCES.tooLarge : CREATE_SENTENCES.notPicture;
}

// True when a share has something in it: a photo, or words once trimmed. The words never pass
// POST_TEXT_MAX_CHARS, which the box allows.
export function canShare(text: string, photo: ChosenPhoto | null): boolean {
  return photo !== null || (text.trim() !== "" && text.trim().length <= POST_TEXT_MAX_CHARS);
}

// Reads once whether the person is in Explore (GET /api/directory/me), for who sees a post and
// where Create goes after sharing.
function useListed(): Listed {
  const [listed, setListed] = useState<Listed>("unknown");
  useEffect(() => {
    let isActive = true;
    readListingOrNull().then(
      (listing) => {
        if (isActive) setListed(listing === null ? "not-listed" : "listed");
      },
      () => undefined,
    );
    return () => {
      isActive = false;
    };
  }, []);
  return listed;
}

// Create's state: a photo is drawn in the browser the moment it is chosen, and again when the kind
// changes, so what shows is what goes up; Share sends POST /api/posts with the photo as base64. The
// address of a drawn photo is let go once it is replaced or the page closes.
export function useCreate(initialKind: PostKind): CreateModel {
  const [kind, setKindState] = useState<PostKind>(initialKind);
  const [photo, setPhoto] = useState<ChosenPhoto | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<ShareState>({ kind: "idle" });
  const listed = useListed();
  const shown = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (shown.current !== null) URL.revokeObjectURL(shown.current);
    },
    [],
  );
  const show = (next: ChosenPhoto | null): void => {
    if (shown.current !== null) URL.revokeObjectURL(shown.current);
    shown.current = next?.url ?? null;
    setPhoto(next);
  };
  const draw = async (forKind: PostKind, file: Blob): Promise<void> => {
    setState({ kind: "drawing" });
    try {
      const jpeg = await drawFor(forKind, file);
      show({ file, jpeg, url: URL.createObjectURL(jpeg) });
      setState({ kind: "idle" });
    } catch (thrown: unknown) {
      setState({
        kind: "refused",
        sentence:
          thrown instanceof PhotoFileError ? photoSentence(thrown) : CREATE_SENTENCES.notPicture,
      });
    }
  };
  const setKind = (next: PostKind): void => {
    if (next === kind) return;
    setKindState(next);
    if (photo !== null) void draw(next, photo.file);
  };
  const share = async (): Promise<PostCreated | null> => {
    if (!canShare(text, photo)) {
      setState({ kind: "refused", sentence: CREATE_SENTENCES.empty });
      return null;
    }
    setState({ kind: "sending" });
    try {
      const body = {
        kind,
        text: text.trim(),
        photo: photo === null ? null : await base64Of(photo.jpeg),
      };
      const created = await apiFetch(routes.social.createPost, { body });
      setState({ kind: "idle" });
      return created;
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
      return null;
    }
  };
  return {
    kind,
    setKind,
    photo,
    pickPhoto: (file) => draw(kind, file),
    removePhoto: () => {
      show(null);
    },
    text,
    setText,
    state,
    listed,
    share,
  };
}
