import { z } from "zod";

// A row id in UUID form, used for people, sources, cards, meetings and every other row.
export const Uuid = z.string().uuid();
// A server time as an ISO string with an offset, so every client reads the same moment.
export const IsoTime = z.string().datetime({ offset: true });
// The key of a photo the web build bundles: a post's photo, or "faces/" and a name for a person's face (3 Nov 2026). Only sample
// people have photos so far. Example: "jun-workbench", "faces/maya".
export const PhotoKey = z.string().max(64).regex(/^(faces\/)?[a-z0-9-]+$/);
// The two people in a meeting. Side a is the person who created the pair.
export const Side = z.enum(["a", "b"]);
