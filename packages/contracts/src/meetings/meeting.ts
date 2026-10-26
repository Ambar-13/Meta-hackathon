import { z } from "zod";
import { IsoTime, Side, Uuid } from "../primitives.js";

// Meetings one person may start per day, D60.
export const MEETINGS_PER_PERSON_PER_DAY = 5;
// How long one meeting runs, in minutes, D34.
export const MEETING_LENGTH_MINUTES = 10;
// The explore phase stops this many minutes into the meeting, D34 and R5.8.
export const EXPLORE_CUTOFF_MINUTES = 8;
// Turns in each phase: open 2, explore up to 6, decide 2, D34.
export const AGENDA = { open: 2, exploreMax: 6, decide: 2 } as const;
// A person counts as present when they were seen this many seconds ago, D53.
export const PRESENCE_WINDOW_SECONDS = 30;
// Where a meeting is in its life, from ready to ended or deleted.
export const MeetingState = z.enum(["ready", "queued", "running", "ended", "deleted"]);
// The type of MeetingState, read from the schema above.
export type MeetingState = z.infer<typeof MeetingState>;
// The phases of a meeting, D34.
export const Phase = z.enum(["open", "explore", "decide", "close"]);
// The type of Phase, read from the schema above.
export type Phase = z.infer<typeof Phase>;
// The body of POST /api/pairs/:id/meetings: a curated question or free text, plus the card to speak from.
// This is a route schema, not a model output, so the union is allowed here.
export const MeetingCreate = z.intersection(
  z.union([z.object({ questionId: z.number().int().min(1).max(12) }), z.object({ freeText: z.string().trim().min(5).max(300) })]),
  z.object({ cardId: Uuid }),
);
// The type of MeetingCreate, read from the schema above.
export type MeetingCreate = z.infer<typeof MeetingCreate>;
// What POST /api/pairs/:id/meetings returns.
export const MeetingCreateResponse = z.object({ meetingId: Uuid });
// The type of MeetingCreateResponse, read from the schema above.
export type MeetingCreateResponse = z.infer<typeof MeetingCreateResponse>;
// One of the two people in a meeting as the lobby and the meeting screen show them.
export const MeetingMember = z.object({
  side: Side,
  displayName: z.string(),
  ready: z.boolean(), // the person gave their go-ahead; when both have, the meeting starts with nobody online
  connected: z.boolean(), // watching now (seen in the last 30 seconds); shown only, never a condition to start
});
// The type of MeetingMember, read from the schema above.
export type MeetingMember = z.infer<typeof MeetingMember>;
// What GET /api/meetings/:id returns.
export const MeetingView = z.object({
  id: Uuid,
  state: MeetingState,
  phase: Phase.optional(),
  questionText: z.string(),
  questionChecked: z.boolean(),
  members: z.array(MeetingMember).length(2),
  viewerSide: Side, // the side of the person who asked for this view, from their meeting_members row
  startedAt: IsoTime.optional(),
  endsAt: IsoTime.optional(),
  queuePosition: z.number().int().optional(),
  serverNow: IsoTime,
});
// The type of MeetingView, read from the schema above.
export type MeetingView = z.infer<typeof MeetingView>;
// What POST /api/meetings/:id/ready returns.
export const MeetingReadyResponse = z.object({ ready: z.literal(true) });
// The type of MeetingReadyResponse, read from the schema above.
export type MeetingReadyResponse = z.infer<typeof MeetingReadyResponse>;
// What POST /api/meetings/:id/start returns: running now, or queued behind other meetings.
export const MeetingStartResponse = z.object({
  state: z.enum(["running", "queued"]),
  queuePosition: z.number().int().optional(),
});
// The type of MeetingStartResponse, read from the schema above.
export type MeetingStartResponse = z.infer<typeof MeetingStartResponse>;
// What the question check model returns: whether the question may be used, and why (R10.5).
export const QuestionCheckOutput = z.object({ allowed: z.boolean(), reason: z.string().min(1).max(200) });
// The type of QuestionCheckOutput, read from the schema above.
export type QuestionCheckOutput = z.infer<typeof QuestionCheckOutput>;
// The 12 curated meeting questions, ids 1 to 12, drafted for the Wave 0 review (R10.5, no input lists them).
export const CURATED_QUESTIONS: ReadonlyArray<{ id: number; text: string }> = [
  { id: 1, text: "Should we build this as a side project or commit full time?" },
  { id: 2, text: "Who decides when we disagree and cannot wait?" },
  { id: 3, text: "How do we split money if one of us does more of the work this month?" },
  { id: 4, text: "What hours do we both promise to be reachable?" },
  { id: 5, text: "Which of our two ideas do we try first, and how do we know it failed?" },
  { id: 6, text: "How much of our own money are we each willing to lose on this?" },
  { id: 7, text: "Do we take outside money early, or stay small until it works?" },
  { id: 8, text: "What would make either of us walk away, and how would we part?" },
  { id: 9, text: "Who talks to customers and who builds, or do we both do both?" },
  { id: 10, text: "How do we give each other hard feedback without it getting personal?" },
  { id: 11, text: "What do we do when one of us wants to ship and the other wants to polish?" },
  { id: 12, text: "If this works, what does each of us want it to become?" },
];
