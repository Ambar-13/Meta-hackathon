import { z } from "zod";

// A row id in UUID form, used for people, sources, cards, meetings and every other row.
export const Uuid = z.string().uuid();
// A server time as an ISO string with an offset, so every client reads the same moment.
export const IsoTime = z.string().datetime({ offset: true });
// The key of a photo: a post's photo or "faces/" and a name for a sample person's face, both bundled in the web build, or "photos/" and
// the id of a profile photo a person put up themselves, which GET /api/photos/:id serves (3 Nov 2026).
// Example: "jun-workbench", "faces/maya", "photos/0f3c2a1e-8d4b-4c6f-9a7e-2b1d5c8e9f00".
export const PhotoKey = z.string().max(64).regex(/^((faces|photos)\/)?[a-z0-9-]+$/);
// The two people in a meeting. Side a is the person who created the pair.
export const Side = z.enum(["a", "b"]);
