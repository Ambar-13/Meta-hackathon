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
// What a meeting question asks the two personas to play out: whether the two people would get along or clash, whether one could help
// the other, how each would react to a situation or what each thinks of a view, a decision between them, a deal between them, or a
// debate on a topic. It sets the meeting's decide turns and the brief's three section labels; no kind ever yields a score or a verdict.
export const QuestionKind = z.enum(["get_along", "help", "situation", "decision", "deal", "debate"]);
// The type of QuestionKind, read from the schema above.
export type QuestionKind = z.infer<typeof QuestionKind>;
// Where a meeting is in its life, from ready to ended or deleted.
export const MeetingState = z.enum(["ready", "queued", "running", "ended", "deleted"]);
// The type of MeetingState, read from the schema above.
export type MeetingState = z.infer<typeof MeetingState>;
// The phases of a meeting, D34.
export const Phase = z.enum(["open", "explore", "decide", "close"]);
// The type of Phase, read from the schema above.
export type Phase = z.infer<typeof Phase>;
// How many curated questions there are; their ids run from 1 to this number.
export const CURATED_QUESTION_COUNT = 16;
// The body of POST /api/pairs/:id/meetings: a curated question or free text, plus the card to speak from.
// This is a route schema, not a model output, so the union is allowed here.
export const MeetingCreate = z.intersection(
  z.union([z.object({ questionId: z.number().int().min(1).max(CURATED_QUESTION_COUNT) }), z.object({ freeText: z.string().trim().min(5).max(300) })]),
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
  questionKind: QuestionKind,
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
// What the question check model returns: whether the question may be used, why, and which kind it is (R10.5). The kind matters only
// when the question is allowed.
export const QuestionCheckOutput = z.object({ allowed: z.boolean(), reason: z.string().min(1).max(200), kind: QuestionKind });
// The type of QuestionCheckOutput, read from the schema above.
export type QuestionCheckOutput = z.infer<typeof QuestionCheckOutput>;
// The 16 curated meeting questions in four groups of 4 as the lobby shows them: getting along or clashing (1 to 4), help (5 to 8),
// deals (9 to 12, where 12 is a decision), and debates and views (13 to 16, where 15 and 16 are situations). Each is about the two
// people only (R10.5).
export const CURATED_QUESTIONS: ReadonlyArray<{ id: number; text: string; kind: QuestionKind }> = [
  { id: 1, text: "Would we enjoy a 10-day hackathon together?", kind: "get_along" },
  { id: 2, text: "Would we get along on a small team, day to day?", kind: "get_along" },
  { id: 3, text: "What would each of us find hard about working with the other?", kind: "get_along" },
  { id: 4, text: "Would we clash, and over what?", kind: "get_along" },
  { id: 5, text: "Where could each of us help the other most?", kind: "help" },
  { id: 6, text: "What could each of us teach the other?", kind: "help" },
  { id: 7, text: "Would we be useful to each other on a side project, and how?", kind: "help" },
  { id: 8, text: "If one of us got stuck, how would the other probably help?", kind: "help" },
  { id: 9, text: "Would we make a deal on how to split a hackathon prize?", kind: "deal" },
  { id: 10, text: "If I build and you sell, would we close that deal tomorrow?", kind: "deal" },
  { id: 11, text: "Would we agree on who owns what if we started a company together?", kind: "deal" },
  { id: 12, text: "What do we do when one of us wants to ship and the other wants to polish?", kind: "decision" },
  { id: 13, text: "Debate: should students start companies before they graduate? Where do our views split?", kind: "debate" },
  { id: 14, text: "Debate: will AI replace most junior engineers? Where do our views split?", kind: "debate" },
  { id: 15, text: "How would we each react if our demo broke an hour before judging?", kind: "situation" },
  { id: 16, text: "Do we see the future of AI the same way?", kind: "situation" },
];
