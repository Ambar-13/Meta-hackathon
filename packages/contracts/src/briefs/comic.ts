import { z } from "zod";
import { Uuid } from "../primitives.js";

// Panels in one comic, D64.
export const COMIC_PANELS = 6;
// Largest size of one panel image in bytes: 150 KB, D64.
export const PANEL_MAX_BYTES = 153_600;
// Seconds all six panel images may take together, D64.
export const COMIC_TOTAL_SECONDS = 60;
// Days a comic is kept unless its share page is published, D64.
export const COMIC_PURGE_DAYS = 30;
// The fixed avatar descriptions. The first is from the inputs; the other five are picked here [confirm].
export const AVATARS = [
  "fox in a hoodie",
  "owl with round glasses",
  "otter in a raincoat",
  "cat with a scarf",
  "penguin with headphones",
  "bear in a cardigan",
] as const;
// One avatar description, checked against the fixed list above (R11.3).
export const Avatar = z.enum(AVATARS);
// The type of Avatar, read from the schema above.
export type Avatar = z.infer<typeof Avatar>;
// The body of POST /api/meetings/:id/comic: the avatar of the person who asks.
export const ComicRequest = z.object({ avatar: Avatar });
// The type of ComicRequest, read from the schema above.
export type ComicRequest = z.infer<typeof ComicRequest>;
// What POST /api/meetings/:id/comic returns: the id of the comic that is rendering.
export const ComicRequestResponse = z.object({ comicId: Uuid });
// The type of ComicRequestResponse, read from the schema above.
export type ComicRequestResponse = z.infer<typeof ComicRequestResponse>;
// Where a comic is in its life.
export const ComicState = z.enum(["rendering", "ready", "failed", "skipped"]);
// The type of ComicState, read from the schema above.
export type ComicState = z.infer<typeof ComicState>;
// What GET /api/meetings/:id/comic returns: the state and the panels that exist so far.
export const ComicView = z.object({
  state: ComicState,
  panels: z.array(
    z.object({
      position: z.number().int().min(1).max(COMIC_PANELS),
      caption: z.string(),
      imageUrl: z.string(),
    }),
  ),
});
// The type of ComicView, read from the schema above.
export type ComicView = z.infer<typeof ComicView>;
// What the comic model returns: one caption and one image prompt for each panel (D64).
export const ComicPanelsOutput = z.object({
  panels: z
    .array(z.object({ caption: z.string().min(1).max(140), image_prompt: z.string().min(1).max(400) }))
    .length(COMIC_PANELS),
});
// The type of ComicPanelsOutput, read from the schema above.
export type ComicPanelsOutput = z.infer<typeof ComicPanelsOutput>;
