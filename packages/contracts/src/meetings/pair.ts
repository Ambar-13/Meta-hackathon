import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";
import { MeetingState } from "./meeting.js";

// Random bytes in an invite token: 128 bits.
export const PAIR_TOKEN_BYTES = 16;
// Hours an invite stays open.
export const PAIR_LIFETIME_HOURS = 24;
// How often the lobby polls for changes, in milliseconds.
export const LOBBY_POLL_MS = 5_000;
// What POST /api/pairs returns: the pair, the invite link and when it expires.
export const PairCreateResponse = z.object({
  pairId: Uuid,
  inviteUrl: z.string().url(),
  expiresAt: IsoTime,
});
export type PairCreateResponse = z.infer<typeof PairCreateResponse>;
// The body of POST /api/pairs/join: the invite token as 32 lower-case hex characters.
export const PairJoin = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/) });
export type PairJoin = z.infer<typeof PairJoin>;
// What joining a pair returns.
export const PairJoinResponse = z.object({ pairId: Uuid });
export type PairJoinResponse = z.infer<typeof PairJoinResponse>;
// One meeting row in the lobby: its state and its question.
export const PairMeetingRow = z.object({
  id: Uuid,
  state: MeetingState,
  questionText: z.string(),
  queuePosition: z.number().int().optional(),
  createdAt: IsoTime,
});
export type PairMeetingRow = z.infer<typeof PairMeetingRow>;
// What GET /api/pairs/:id returns to the lobby.
export const PairView = z.object({
  id: Uuid,
  creator: z.object({ displayName: z.string() }),
  joiner: z.object({ displayName: z.string() }).optional(),
  meetings: z.array(PairMeetingRow), // newest first, by createdAt
  expiresAt: IsoTime,
  serverNow: IsoTime,
});
export type PairView = z.infer<typeof PairView>;
