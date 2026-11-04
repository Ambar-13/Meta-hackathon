import type { FastifyBaseLogger } from "fastify";
import {
  EVENT_VERSION,
  HEARTBEAT_MS,
  SERVER_SAFETY_POLL_MS,
  SSE_PADDING_BYTES,
  TurnDelta,
  type CommittedEvent,
} from "@meet-first/contracts";
import type { WakeSignal } from "./listen-fan-out.js";
import type { RunningPartial, StreamReads } from "./replay-and-poll.js";

// The SSE response headers; nothing else is set on the stream.
export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;
// One comment line of exactly SSE_PADDING_BYTES (2,048) bytes, written first so a proxy that holds
// back the first 2 KB lets the stream through: a colon, 2,045 spaces, and the blank line that ends
// a frame.
export const SSE_PADDING = `:${" ".repeat(SSE_PADDING_BYTES - 3)}\n\n`;
// The heartbeat comment, written every HEARTBEAT_MS, 15 s.
export const HEARTBEAT_LINE = ":hb\n\n";
// How often a stream writes the heartbeat, how often it re-reads on its own, and how often it
// re-checks its session.
export type StreamTiming = { heartbeatMs: number; safetyPollMs: number; sessionCheckMs: number };
// The timing every real stream uses: the 15 s heartbeat, the 10 s safety poll, and a session
// re-check at the heartbeat interval by default, so a signed-out session ends its stream within one
// heartbeat.
export const STREAM_TIMING: StreamTiming = {
  heartbeatMs: HEARTBEAT_MS,
  safetyPollMs: SERVER_SAFETY_POLL_MS,
  sessionCheckMs: HEARTBEAT_MS,
};
// What one stream has sent of a running step's partial text.
export type SentDelta = { stepSeq: number; attempt: number; sentLen: number };
// One open stream.
export type Subscriber = {
  start: () => void;
  wake: (signal: WakeSignal) => void;
  stop: () => void;
  end: () => void;
  whenIdle: () => Promise<void>;
};
// What a subscriber needs; write and end are the HTTP response's. sessionStillValid answers whether
// the session and the membership that opened the stream still hold; a false answer, or a failed
// check, ends the stream.
export type SubscriberOptions = {
  personId: string;
  meetingId: string;
  lastSeq: number;
  reads: StreamReads;
  write: (chunk: string) => void;
  end: () => void;
  now: () => Date;
  log: FastifyBaseLogger;
  timing: StreamTiming;
  sessionStillValid: () => Promise<boolean>;
};
// The open streams of one process, at most a fixed number per person and meeting.
export type ConnectionLimit<T> = {
  admit: (key: string, stream: T) => void;
  release: (key: string, stream: T) => void;
  endAll: () => void;
  count: (key: string) => number;
};

// A committed event as one SSE frame: its seq as the id, its type as the event name, the whole
// event as JSON.
export function formatCommittedEvent(event: CommittedEvent): string {
  return `id: ${String(event.seq)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// A turn.delta as one SSE frame with no id line, so a reconnect never replays from a delta.
export function formatDelta(delta: TurnDelta): string {
  return `event: turn.delta\ndata: ${JSON.stringify(delta)}\n\n`;
}

// What to send of a running step's partial text, given what this stream already sent.
export function nextDelta(
  sent: SentDelta | null,
  partial: RunningPartial | null,
): { offset: number; text: string } | null {
  if (partial === null || partial.text.length === 0) {
    return null;
  }
  if (sent === null || sent.stepSeq !== partial.stepSeq || sent.attempt !== partial.attempt) {
    return { offset: 0, text: partial.text };
  }
  if (partial.text.length > sent.sentLen) {
    return { offset: sent.sentLen, text: partial.text.slice(sent.sentLen) };
  }
  return null;
}

// True when a delta payload may carry text this stream has not sent; false lets the stream skip the
// read.
export function isDeltaNews(
  sent: SentDelta | null,
  payload: { stepSeq: number; attempt: number; len: number },
): boolean {
  return (
    sent === null ||
    sent.stepSeq !== payload.stepSeq ||
    sent.attempt !== payload.attempt ||
    payload.len > sent.sentLen
  );
}

// Keeps at most max open streams per key and ends the oldest when one more arrives.
export function makeConnectionLimit<T extends { end: () => void }>(
  max: number,
): ConnectionLimit<T> {
  const map = new Map<string, T[]>();
  return {
    admit: (key, stream) => {
      const list = map.get(key) ?? [];
      list.push(stream);
      map.set(key, list);
      while (list.length > max) {
        list.shift()?.end();
      }
    },
    release: (key, stream) => {
      const list = map.get(key);
      if (list === undefined) {
        return;
      }
      const index = list.indexOf(stream);
      if (index >= 0) {
        list.splice(index, 1);
      }
      if (list.length === 0) {
        map.delete(key);
      }
    },
    endAll: () => {
      const streams = [...map.values()].flat();
      map.clear();
      for (const stream of streams) {
        stream.end();
      }
    },
    count: (key) => map.get(key)?.length ?? 0,
  };
}

// The connection-limit key: one person in one meeting.
export function connectionKey(personId: string, meetingId: string): string {
  return `${personId}:${meetingId}`;
}

// One open stream: its reads run one at a time, in the order they were asked for.
class StreamSubscriber implements Subscriber {
  private lastSentSeq: number;
  private sent: SentDelta | null = null;
  private isStopped = false;
  private chain: Promise<void> = Promise.resolve();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private sessionTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: SubscriberOptions) {
    this.lastSentSeq = options.lastSeq;
  }

  // Starts the replay, the running partial and the presence stamp, then the heartbeat and the
  // safety poll.
  start(): void {
    this.enqueue(() => this.pumpEvents());
    this.enqueue(() => this.pumpPartial());
    this.enqueue(() =>
      this.options.reads.touchPresence(this.options.personId, this.options.meetingId),
    );
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, this.options.timing.heartbeatMs);
    this.pollTimer = setInterval(() => {
      this.wake({ kind: "poll" });
    }, this.options.timing.safetyPollMs);
    this.sessionTimer = setInterval(() => {
      this.checkSession();
    }, this.options.timing.sessionCheckMs);
  }

  // Queues one session check behind the reads already waiting, so it never runs beside a frame
  // being written.
  private checkSession(): void {
    this.enqueue(() => this.verifySession());
  }

  // Ends the stream when the session or the membership no longer holds. A check that cannot be made
  // counts as a failure, so the stream fails closed rather than keep sending events it cannot vouch
  // for.
  private async verifySession(): Promise<void> {
    let isStillValid = false;
    try {
      isStillValid = await this.options.sessionStillValid();
    } catch (error) {
      this.options.log.warn(
        { code: "stream_session_check_failed", meetingId: this.options.meetingId, err: error },
        "stream_session_check_failed",
      );
    }
    if (!isStillValid) {
      this.options.log.info(
        { code: "stream_session_ended", meetingId: this.options.meetingId },
        "stream_session_ended",
      );
      this.end();
    }
  }

  // Writes the heartbeat comment and stamps presence, so the other member sees this person as
  // watching.
  private heartbeat(): void {
    if (this.isStopped) {
      return;
    }
    this.options.write(HEARTBEAT_LINE);
    this.enqueue(() =>
      this.options.reads.touchPresence(this.options.personId, this.options.meetingId),
    );
  }

  // Reacts to one notice: an event newer than the last sent seq, a delta with new text, or a poll
  // that reads both.
  wake(signal: WakeSignal): void {
    if (this.isStopped) {
      return;
    }
    if (signal.kind === "event") {
      if (signal.seq > this.lastSentSeq) {
        this.enqueue(() => this.pumpEvents());
      }
      return;
    }
    if (signal.kind === "delta") {
      if (isDeltaNews(this.sent, signal)) {
        this.enqueue(() => this.pumpPartial());
      }
      return;
    }
    this.enqueue(() => this.pumpEvents());
    this.enqueue(() => this.pumpPartial());
  }

  // Adds one read to the end of the chain. A failed read is logged, and the next wake or poll tries
  // again.
  private enqueue(work: () => Promise<void>): void {
    this.chain = this.chain
      .then(async () => {
        if (!this.isStopped) {
          await work();
        }
      })
      .catch((error: unknown) => {
        this.options.log.warn(
          { code: "stream_read_failed", meetingId: this.options.meetingId, err: error },
          "stream_read_failed",
        );
      });
  }

  // Sends every committed event after the last sent seq, in order, and no event twice.
  private async pumpEvents(): Promise<void> {
    const events = await this.options.reads.readEventsAfter(
      this.options.personId,
      this.options.meetingId,
      this.lastSentSeq,
    );
    for (const event of events) {
      if (this.isStopped) {
        return;
      }
      if (event.seq <= this.lastSentSeq) {
        continue;
      }
      this.options.write(formatCommittedEvent(event));
      this.lastSentSeq = event.seq;
    }
  }

  // Sends the running step's partial text as a turn.delta, but only the part this stream has not
  // sent yet.
  private async pumpPartial(): Promise<void> {
    const partial = await this.options.reads.readRunningPartial(
      this.options.personId,
      this.options.meetingId,
    );
    const delta = nextDelta(this.sent, partial);
    if (delta === null || partial === null || this.isStopped) {
      return;
    }
    const frame = TurnDelta.parse({
      v: EVENT_VERSION,
      type: "turn.delta",
      meetingId: this.options.meetingId,
      at: this.options.now().toISOString(),
      stepSeq: partial.stepSeq,
      attempt: partial.attempt,
      side: partial.side,
      offset: delta.offset,
      text: delta.text,
    });
    this.options.write(formatDelta(frame));
    this.sent = {
      stepSeq: partial.stepSeq,
      attempt: partial.attempt,
      sentLen: partial.text.length,
    };
  }

  // Stops the reads and the timers. Safe to call twice.
  stop(): void {
    this.isStopped = true;
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.sessionTimer !== null) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  // Stops the stream and ends the HTTP response.
  end(): void {
    this.stop();
    this.options.end();
  }

  // Resolves when every read asked for so far has finished.
  whenIdle(): Promise<void> {
    return this.chain;
  }
}

// Builds one stream: replay, partial, heartbeat, safety poll and wakes, each read run one at a time
// in order.
export function createSubscriber(options: SubscriberOptions): Subscriber {
  return new StreamSubscriber(options);
}
