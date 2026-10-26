import { z } from "zod";

// A row id in UUID form, used for people, sources, cards, meetings and every other row.
export const Uuid = z.string().uuid();
// A server time as an ISO string with an offset, so every client reads the same moment.
export const IsoTime = z.string().datetime({ offset: true });
// The two people in a meeting. Side a is the person who created the pair.
export const Side = z.enum(["a", "b"]);
