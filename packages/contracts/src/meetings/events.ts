import { z } from "zod";
import { ContractError } from "../operations/errors.js";
import { IsoTime, Side, Uuid } from "../primitives.js";
import { Claim } from "./claims.js";
import { Phase } from "./meeting.js";
import { ToolName } from "./tools.js";

// Version of every meeting event. A browser on another version asks the person to refresh.
export const EVENT_VERSION = 1;
// How often the server sends a heartbeat on the event stream, in milliseconds.
export const HEARTBEAT_MS = 15_000;
// Comment padding sent first on the event stream, so proxies flush early.
export const SSE_PADDING_BYTES = 2_048;
// How long the browser waits for the first byte before it polls, in milliseconds.
export const SSE_FIRST_BYTE_MS = 5_000;
// How often the browser polls while the stream is down, in milliseconds.
export const POLL_MS = 2_000;
// How often the server re-reads for a lost notification, in milliseconds.
export const SERVER_SAFETY_POLL_MS = 10_000;
// Reconnect delays: start at 1 second, double each time, stop growing at 30 seconds.
export const RECONNECT = { firstMs: 1_000, factor: 2, capMs: 30_000 } as const;
// Connections one person may hold to one meeting; the oldest closes past this.
export const CONNECTIONS_PER_PERSON_PER_MEETING = 3;
// How often partial text is flushed to the database, in milliseconds.
export const PARTIAL_FLUSH_MS = 250;
// Fields every event carries.
const base = { v: z.literal(EVENT_VERSION), meetingId: Uuid, at: IsoTime };
// Fields only committed events carry: a gapless sequence number.
const committed = { ...base, seq: z.number().int().min(1) };
// The meeting has started; the browser shows the question and both names.
export const MeetingStarted = z.object({
  ...committed,
  type: z.literal("meeting.started"),
  startedAt: IsoTime,
  endsAt: IsoTime,
  question: z.string(),
  members: z.array(z.object({ side: Side, displayName: z.string() })).length(2),
});
// The type of MeetingStarted, read from the schema above.
export type MeetingStarted = z.infer<typeof MeetingStarted>;
// The meeting moved to a new phase.
export const PhaseChanged = z.object({ ...committed, type: z.literal("phase.changed"), phase: Phase, stepSeq: z.number().int() });
// The type of PhaseChanged, read from the schema above.
export type PhaseChanged = z.infer<typeof PhaseChanged>;
// A slice of a turn still being written. It is not stored and has no seq, so a reconnect never replays it.
export const TurnDelta = z.object({
  ...base,
  type: z.literal("turn.delta"),
  stepSeq: z.number().int(),
  attempt: z.number().int(),
  side: Side,
  offset: z.number().int().min(0),
  text: z.string(),
});
// The type of TurnDelta, read from the schema above.
export type TurnDelta = z.infer<typeof TurnDelta>;
// One finished turn with its claims, written in the same transaction as the step's done state.
export const TurnCommitted = z.object({
  ...committed,
  type: z.literal("turn.committed"),
  stepSeq: z.number().int(),
  side: Side,
  phase: Phase,
  text: z.string(),
  claims: z.array(Claim),
});
// The type of TurnCommitted, read from the schema above.
export type TurnCommitted = z.infer<typeof TurnCommitted>;
// A persona called a tool.
export const ToolCalled = z.object({
  ...committed,
  type: z.literal("tool.called"),
  stepSeq: z.number().int(),
  side: Side,
  tool: ToolName,
  args: z.record(z.unknown()),
});
// The type of ToolCalled, read from the schema above.
export type ToolCalled = z.infer<typeof ToolCalled>;
// The result of a tool call.
export const ToolResult = z.object({
  ...committed,
  type: z.literal("tool.result"),
  stepSeq: z.number().int(),
  side: Side,
  tool: ToolName,
  result: z.record(z.unknown()),
});
// The type of ToolResult, read from the schema above.
export type ToolResult = z.infer<typeof ToolResult>;
// A persona accepted the other side's claim.
export const Concede = z.object({
  ...committed,
  type: z.literal("concede"),
  stepSeq: z.number().int(),
  side: Side,
  claimId: Uuid,
  reason: z.string(),
});
// The type of Concede, read from the schema above.
export type Concede = z.infer<typeof Concede>;
// A persona kept its position.
export const Hold = z.object({ ...committed, type: z.literal("hold"), stepSeq: z.number().int(), side: Side, reason: z.string() });
// The type of Hold, read from the schema above.
export type Hold = z.infer<typeof Hold>;
// The meeting is over: decided, out of token budget, or deleted.
export const MeetingEnded = z.object({
  ...committed,
  type: z.literal("meeting.ended"),
  reason: z.enum(["decided", "budget", "deleted"]),
  endedAt: IsoTime,
});
// The type of MeetingEnded, read from the schema above.
export type MeetingEnded = z.infer<typeof MeetingEnded>;
// The two briefs are written. The support rate of each side is null when it could not be judged.
export const BriefReady = z.object({
  ...committed,
  type: z.literal("brief.ready"),
  supportRate: z.object({ a: z.number().nullable(), b: z.number().nullable() }),
});
// The type of BriefReady, read from the schema above.
export type BriefReady = z.infer<typeof BriefReady>;
// The comic is ready to view.
export const ComicReady = z.object({ ...committed, type: z.literal("comic.ready"), comicId: Uuid });
// The type of ComicReady, read from the schema above.
export type ComicReady = z.infer<typeof ComicReady>;
// The comic was not made, with the reason.
export const ComicSkipped = z.object({ ...committed, type: z.literal("comic.skipped"), comicId: Uuid, reason: z.string() });
// The type of ComicSkipped, read from the schema above.
export type ComicSkipped = z.infer<typeof ComicSkipped>;
// Any committed event, told apart by its type.
export const CommittedEvent = z.discriminatedUnion("type", [
  MeetingStarted,
  PhaseChanged,
  TurnCommitted,
  ToolCalled,
  ToolResult,
  Concede,
  Hold,
  MeetingEnded,
  BriefReady,
  ComicReady,
  ComicSkipped,
]);
// The type of CommittedEvent, read from the schema above.
export type CommittedEvent = z.infer<typeof CommittedEvent>;
// Any event that can reach the browser, committed or a delta.
export const MeetingEvent = z.union([CommittedEvent, TurnDelta]);
// The type of MeetingEvent, read from the schema above.
export type MeetingEvent = z.infer<typeof MeetingEvent>;
// The 11 committed type names, for the CHECK list in 0001.
export const COMMITTED_EVENT_TYPES = CommittedEvent.options.map((option) => option.shape.type.value);
// The keys of a committed event that live in their own meeting_events columns, not in payload.
const KEYS_STORED_APART = new Set(["v", "type", "meetingId", "seq", "at"]);
// One stored meeting_events row, as Kysely selects it. created_at is the event's time.
export type MeetingEventRow = { meeting_id: string; seq: number; type: string; v: number; payload: Record<string, unknown>; created_at: Date | string };
// Rebuilds and checks one committed event from its row. A row that no longer matches its schema is a server fault.
export function rowToEvent(row: MeetingEventRow): CommittedEvent {
  const parsed = CommittedEvent.safeParse({
    ...row.payload,
    v: row.v,
    type: row.type,
    meetingId: row.meeting_id,
    seq: row.seq,
    at: new Date(row.created_at).toISOString(),
  });
  if (!parsed.success) {
    throw new ContractError("event_row_invalid", "A stored meeting event does not match its schema. Check the code that wrote this event type.", 500);
  }
  return parsed.data;
}
// The payload column for one committed event: the event without v, type, meetingId, seq and at. A writer stores
// { meeting_id: event.meetingId, seq: event.seq, type: event.type, v: event.v, payload: eventToPayload(event), created_at: event.at }.
export function eventToPayload(event: CommittedEvent): Record<string, unknown> {
  return Object.fromEntries(Object.entries(event).filter(([key]) => !KEYS_STORED_APART.has(key)));
}
// What the poll route returns: committed events after a sequence number, the partial turn, and the server time.
export const PollResponse = z.object({
  v: z.literal(EVENT_VERSION),
  events: z.array(CommittedEvent),
  partial: z.object({ stepSeq: z.number().int(), attempt: z.number().int(), side: Side, text: z.string() }).nullable(),
  serverNow: IsoTime,
});
// The type of PollResponse, read from the schema above.
export type PollResponse = z.infer<typeof PollResponse>;
// The words a person sees when the model refused to answer. The text is fixed by.
export const REFUSAL_TEXT = "I'd rather my human speak to this";
// The words shown when a browser is on an older event version.
export const REFRESH_COPY = "refresh for the new version";
