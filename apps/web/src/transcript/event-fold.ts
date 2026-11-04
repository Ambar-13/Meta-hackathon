import {
  CommittedEvent,
  EVENT_VERSION,
  MeetingEvent,
  recallArgs,
  recallResult,
  REFRESH_COPY,
  type Claim,
  type Phase,
  type TurnDelta,
} from "@meet-first/contracts";
import { applyDelta, type PartialTurn } from "./partial-text.js";

// A side letter, as contracts writes it.
export type Side = Claim["side"];
// One line of the meeting as the screen shows it, in seq order.
export type TimelineItem =
  | {
      kind: "turn";
      seq: number;
      stepSeq: number;
      side: Side;
      phase: Phase;
      text: string;
      claims: Claim[];
    }
  | { kind: "phase"; seq: number; phase: Phase }
  | { kind: "recall"; seq: number; side: Side; query: string }
  | { kind: "recall_result"; seq: number; side: Side; found: number }
  | { kind: "concede"; seq: number; side: Side; reason: string }
  | { kind: "hold"; seq: number; side: Side; reason: string };
// The whole state of one meeting screen.
export type MeetingFoldState = {
  meetingId: string;
  lastSeq: number; // highest committed seq applied; 0 before any
  lastCommittedStepSeq: number; // highest stepSeq with a turn.committed; 0 before any
  started: {
    startedAt: string;
    endsAt: string;
    question: string;
    members: Array<{ side: Side; displayName: string }>;
  } | null;
  phase: Phase | null;
  timeline: TimelineItem[];
  partial: PartialTurn | null;
  ended: { reason: "decided" | "budget" | "deleted"; endedAt: string } | null;
  isBriefReady: boolean;
  comic: { comicId: string; isReady: boolean; reason: string | null } | null;
  needsRefresh: boolean;
  resyncRequested: boolean;
};
// A poll reply after the lenient parse of poll-fallback.ts.
export type PollReply = {
  v: number;
  events: unknown[];
  partial: PartialTurn | null;
  serverNow: string;
};
// What one raw event is: readable, from a newer version that needs a refresh, or something to ignore.
export type EventReading =
  | { kind: "event"; event: MeetingEvent }
  | { kind: "refresh" }
  | { kind: "ignored" };

// How long a running meeting may be silent before the screen says it is still thinking (20 s).
export const THINKING_AFTER_MS = 20_000;

// A fresh state for one meeting, before any event.
export function emptyMeetingState(meetingId: string): MeetingFoldState {
  return {
    meetingId,
    lastSeq: 0,
    lastCommittedStepSeq: 0,
    started: null,
    phase: null,
    timeline: [],
    partial: null,
    ended: null,
    isBriefReady: false,
    comic: null,
    needsRefresh: false,
    resyncRequested: false,
  };
}

// Reads one raw event: a v other than EVENT_VERSION needs a refresh, an unknown or unreadable event is ignored.
export function readMeetingEvent(raw: unknown): EventReading {
  if (typeof raw !== "object" || raw === null) return { kind: "ignored" };
  const version: unknown = "v" in raw ? raw.v : undefined;
  if (typeof version === "number" && Math.trunc(version) !== EVENT_VERSION)
    return { kind: "refresh" };
  const parsed = MeetingEvent.safeParse(raw);
  return parsed.success ? { kind: "event", event: parsed.data } : { kind: "ignored" };
}

// Folds one raw event from the stream: sets needsRefresh for a newer v, changes nothing for an ignored one, else foldEvent.
export function foldRaw(state: MeetingFoldState, raw: unknown): MeetingFoldState {
  const reading = readMeetingEvent(raw);
  if (reading.kind === "refresh") return { ...state, needsRefresh: true };
  if (reading.kind === "ignored") return state;
  return foldEvent(state, reading.event);
}

// Folds a delta through the partial-text rule.
function foldDelta(state: MeetingFoldState, delta: TurnDelta): MeetingFoldState {
  const outcome = applyDelta(state.partial, delta, state.lastCommittedStepSeq);
  if (outcome.kind === "apply") return { ...state, partial: outcome.partial };
  if (outcome.kind === "resync") return { ...state, resyncRequested: true };
  return state;
}

// Folds one parsed event: committed events strictly in seq order, deltas by the partial-text rule.
export function foldEvent(state: MeetingFoldState, event: MeetingEvent): MeetingFoldState {
  if (event.type === "turn.delta") return foldDelta(state, event);
  if (event.seq <= state.lastSeq) return state;
  if (event.seq > state.lastSeq + 1) return { ...state, resyncRequested: true };
  return applyCommitted({ ...state, lastSeq: event.seq }, event);
}

// Adds one line to the timeline.
function addLine(state: MeetingFoldState, item: TimelineItem): MeetingFoldState {
  return { ...state, timeline: [...state.timeline, item] };
}

// Folds the events that start, move or add lines to the meeting.
function applyFirst(state: MeetingFoldState, event: CommittedEvent): MeetingFoldState {
  switch (event.type) {
    case "meeting.started":
      return {
        ...state,
        started: {
          startedAt: event.startedAt,
          endsAt: event.endsAt,
          question: event.question,
          members: event.members,
        },
      };
    case "phase.changed":
      return {
        ...addLine(state, { kind: "phase", seq: event.seq, phase: event.phase }),
        phase: event.phase,
      };
    case "turn.committed":
      return applyTurn(state, event);
    case "tool.called":
      return event.tool === "recall"
        ? addLine(state, {
            kind: "recall",
            seq: event.seq,
            side: event.side,
            query: recallQuery(event.args),
          })
        : state;
    case "tool.result":
      return event.tool === "recall"
        ? addLine(state, {
            kind: "recall_result",
            seq: event.seq,
            side: event.side,
            found: recallFound(event.result),
          })
        : state;
    default:
      return applyLast(state, event);
  }
}

// The query of a recall call, or an empty text when the arguments do not read.
function recallQuery(args: Record<string, unknown>): string {
  const parsed = recallArgs.safeParse(args);
  return parsed.success ? parsed.data.query : "";
}

// The number of notes a recall found, or 0 when the result does not read.
function recallFound(result: Record<string, unknown>): number {
  const parsed = recallResult.safeParse(result);
  return parsed.success ? parsed.data.turns.length : 0;
}

// Folds a committed turn: it replaces the streamed text, and an older partial stays only when it is for a later step.
function applyTurn(
  state: MeetingFoldState,
  event: Extract<CommittedEvent, { type: "turn.committed" }>,
): MeetingFoldState {
  const next = addLine(state, {
    kind: "turn",
    seq: event.seq,
    stepSeq: event.stepSeq,
    side: event.side,
    phase: event.phase,
    text: event.text,
    claims: event.claims,
  });
  const isKeepingPartial = next.partial !== null && next.partial.stepSeq > event.stepSeq;
  return {
    ...next,
    lastCommittedStepSeq: Math.max(next.lastCommittedStepSeq, event.stepSeq),
    partial: isKeepingPartial ? next.partial : null,
  };
}

// Folds the remaining events: the lines of concede and hold, the end of a meeting, and the brief and comic results.
function applyLast(state: MeetingFoldState, event: CommittedEvent): MeetingFoldState {
  switch (event.type) {
    case "concede":
      return addLine(state, {
        kind: "concede",
        seq: event.seq,
        side: event.side,
        reason: event.reason,
      });
    case "hold":
      return addLine(state, {
        kind: "hold",
        seq: event.seq,
        side: event.side,
        reason: event.reason,
      });
    case "meeting.ended":
      return { ...state, ended: { reason: event.reason, endedAt: event.endedAt }, partial: null };
    case "brief.ready":
      return { ...state, isBriefReady: true };
    case "comic.ready":
      return { ...state, comic: { comicId: event.comicId, isReady: true, reason: null } };
    case "comic.skipped":
      return { ...state, comic: { comicId: event.comicId, isReady: false, reason: event.reason } };
    default:
      return state;
  }
}

// Applies one committed event: the first group of types, then the rest.
function applyCommitted(state: MeetingFoldState, event: CommittedEvent): MeetingFoldState {
  return applyFirst(state, event);
}

// The committed event a poll reply entry holds, or null for a delta or an unreadable entry.
function committedFrom(raw: unknown): CommittedEvent | null {
  const reading = readMeetingEvent(raw);
  if (reading.kind !== "event" || reading.event.type === "turn.delta") return null;
  return reading.event;
}

// Folds a poll reply: its events after lastSeq in seq order, its partial in place of ours, and the resync request cleared.
export function foldPollReply(state: MeetingFoldState, reply: PollReply): MeetingFoldState {
  if (Math.trunc(reply.v) !== EVENT_VERSION)
    return { ...state, needsRefresh: true, resyncRequested: false };
  const readings = reply.events.map(readMeetingEvent);
  const needsRefresh = state.needsRefresh || readings.some((reading) => reading.kind === "refresh");
  const committed = reply.events
    .flatMap((raw) => {
      const event = committedFrom(raw);
      return event === null ? [] : [event];
    })
    .filter((event) => event.seq > state.lastSeq)
    .sort((first, second) => first.seq - second.seq);
  const applied = committed.reduce(
    (next, event) => applyCommitted({ ...next, lastSeq: event.seq }, event),
    { ...state, needsRefresh },
  );
  const partial =
    reply.partial !== null && reply.partial.stepSeq > applied.lastCommittedStepSeq
      ? reply.partial
      : null;
  return { ...applied, partial, resyncRequested: false };
}

// The refresh line to show, REFRESH_COPY, or null.
export function refreshNotice(state: MeetingFoldState): string | null {
  return state.needsRefresh ? REFRESH_COPY : null;
}

// True when a claim carries the "no receipt" mark because its quote did not verify.
export function claimNeedsMark(claim: Claim): boolean {
  return !claim.verified;
}

// True when the meeting has started and not ended, and nothing arrived for THINKING_AFTER_MS.
export function isThinking(
  state: MeetingFoldState,
  lastActivityMs: number,
  nowMs: number,
): boolean {
  return (
    state.started !== null && state.ended === null && nowMs - lastActivityMs >= THINKING_AFTER_MS
  );
}
