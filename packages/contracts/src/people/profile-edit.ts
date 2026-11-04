import { z } from "zod";
import { PhotoKey } from "../primitives.js";

// The longest display name a person may choose, as at sign-up.
export const DISPLAY_NAME_MAX_CHARS = 80;
// The largest profile photo the api takes, in bytes: a square JPEG the browser drew, which is well under this at 480 px.
export const PROFILE_PHOTO_MAX_BYTES = 400_000;

// The body of PUT /api/people/me/name: the person's new display name (Instagram's Edit profile).
export const NameUpdate = z.object({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_CHARS),
});
export type NameUpdate = z.infer<typeof NameUpdate>;
// What PUT /api/people/me/name returns: the name as saved.
export const NameUpdated = z.object({ displayName: z.string() });
export type NameUpdated = z.infer<typeof NameUpdated>;
// What PUT and DELETE /api/people/me/photo return: the person's photo key after the change, null once removed.
export const MyPhoto = z.object({ photo: PhotoKey.nullable() });
export type MyPhoto = z.infer<typeof MyPhoto>;
