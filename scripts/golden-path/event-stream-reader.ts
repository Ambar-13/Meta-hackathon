// Reads one meeting's event stream the way the browser does, records every event in arrival order, and reports any replay or schema problem.
import {
  CommittedEvent,
  EVENT_VERSION,
  MeetingEvent,
  RECONNECT,
  TurnDelta,
} from "@meet-first/contracts";
import type { PersonClient } from "./person-client.js";
import { StepFailure } from "./report.js";

// Options for one reader. Reader A sets plannedDisconnectAtSeq to PLANNED_DISCONNECT_SEQ, so the stream is cut and resumed once (step 8).
export type ReaderOptions = { plannedDisconnectAtSeq?: number };
// The planned disconnect reopens the stream after this many milliseconds (the spec's 500).
const PLANNED_RECONNECT_MS = 500;
// The most unplanned reconnects one reader makes before it fails (the spec's 5).
const MAX_UNPLANNED_RECONNECTS = 5;
// A reconnect may be up to 20% shorter than its base delay, so phones do not reconnect together.
const JITTER_FRACTION = 0.2;

// One connection: its abort controller, its body reader, whether this reader ended it on purpose, and whether it has carried an event.
type Connection = {
  controller: AbortController;
  body: ReadableStreamDefaultReader<Uint8Array> | undefined;
  isIntentional: boolean;
  hasSeenEvent: boolean;
};
// A caller waiting for an event that matches its predicate.
type Waiter = {
  predicate: (event: MeetingEvent) => boolean;
  resolve: (event: MeetingEvent) => void;
  reject: (error: Error) => void;
};
// One parsed SSE frame: its id line, its event name, its data text and whether it carried the heartbeat comment.
type Frame = {
  id: string | undefined;
  event: string | undefined;
  data: string;
  isHeartbeat: boolean;
};

// Reads one SSE frame: the id, event and data lines, and the heartbeat comment. Other comment lines are padding.
function parseFrame(text: string): Frame {
  let id: string | undefined;
  let event: string | undefined;
  let isHeartbeat = false;
  const dataLines: string[] = [];
  for (const line of text.split("\n")) {
    if (line === ":hb") isHeartbeat = true;
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  return { id, event, data: dataLines.join("\n"), isHeartbeat };
}

// Parses a data line as a JSON object, or returns undefined when it is not one.
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

// Shows a primitive value in a message, and only its type for anything else.
function show(value: unknown): string {
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean"
    ? String(value)
    : typeof value;
}

// The text of an error, for a problem message.
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : show(error);
}

// The wait before reconnect number attempt (0 first): the first delay doubled each time, capped, then cut by up to 20% at random.
function reconnectDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(RECONNECT.capMs, RECONNECT.firstMs * RECONNECT.factor ** attempt);
  return Math.round(base * (1 - JITTER_FRACTION * random()));
}

// Reads one meeting's events over HTTP. Every problem it sees is kept, and assertGapless fails with the first one.
export class EventStreamReader {
  private readonly seen: CommittedEvent[] = [];
  private readonly deltaList: TurnDelta[] = [];
  private readonly arrivalLog: MeetingEvent[] = [];
  private readonly problems: string[] = [];
  private waiters: Waiter[] = [];
  private current: Connection | undefined;
  private maxSeq = 0;
  private unplannedCount = 0;
  private isStopped = true;
  private isPlannedDone = false;
  private startedAt: number | undefined;
  private firstByte: number | undefined;
  private firstHeartbeat: number | undefined;

  constructor(
    readonly client: PersonClient,
    readonly meetingId: string,
    private readonly options: ReaderOptions = {},
  ) {}

  // Every committed event seen so far, in arrival order.
  get committed(): readonly CommittedEvent[] {
    return this.seen;
  }

  // Every turn delta seen so far, in arrival order.
  get deltas(): readonly TurnDelta[] {
    return this.deltaList;
  }

  // Every event seen so far, committed and delta, in arrival order.
  get arrivals(): readonly MeetingEvent[] {
    return this.arrivalLog;
  }

  // The highest seq seen so far, or 0 before the first event.
  get lastSeq(): number {
    return this.maxSeq;
  }

  // Milliseconds from the first open to the first body byte, or undefined before any byte.
  get firstByteAtMs(): number | undefined {
    return this.firstByte;
  }

  // Milliseconds from the first open to the first heartbeat, or undefined before one.
  get firstHeartbeatAtMs(): number | undefined {
    return this.firstHeartbeat;
  }

  // True once the planned disconnect at the set seq has happened.
  get hasPlannedDisconnect(): boolean {
    return this.isPlannedDone;
  }

  // Opens the stream, sending Last-Event-ID with the last seq seen, so the server replays from the next one.
  async open(): Promise<void> {
    this.isStopped = false;
    this.startedAt ??= Date.now();
    await this.connect();
  }

  // Closes the current connection and keeps what was seen. The next open replays from the last seq.
  close(): void {
    this.isStopped = true;
    if (this.current !== undefined) this.interrupt(this.current);
  }

  // Resolves with the first event that matches, seen earlier or later. Rejects after timeoutMs, or at once when a problem was recorded.
  waitFor(predicate: (event: MeetingEvent) => boolean, timeoutMs: number): Promise<MeetingEvent> {
    const found = this.arrivalLog.find(predicate);
    if (found !== undefined) return Promise.resolve(found);
    return this.waitForNext(predicate, timeoutMs);
  }

  // Resolves with the first matching event that arrives from now on; events seen earlier do not count. Rejects like waitFor.
  waitForNext(
    predicate: (event: MeetingEvent) => boolean,
    timeoutMs: number,
  ): Promise<MeetingEvent> {
    const [problem] = this.problems;
    if (problem !== undefined) return Promise.reject(new StepFailure(problem));
    return new Promise<MeetingEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new StepFailure(`stream_wait_timeout after ${String(timeoutMs)} ms`));
      }, timeoutMs);
      const waiter: Waiter = {
        predicate,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.push(waiter);
    });
  }

  // Fails with the first problem recorded (a duplicate, a skipped seq, a bad version, a bad schema, a delta with an id), or with the first gap in the seq numbers.
  assertGapless(): void {
    const [problem] = this.problems;
    if (problem !== undefined) throw new StepFailure(problem);
    for (const [index, event] of this.seen.entries()) {
      if (event.seq !== index + 1)
        throw new StepFailure(`replay_gap expected=${String(index + 1)} got=${String(event.seq)}`);
    }
  }

  // Starts one connection and its background reader. It resolves once the server has answered with the stream.
  private async connect(): Promise<void> {
    const connection: Connection = {
      controller: new AbortController(),
      body: undefined,
      isIntentional: false,
      hasSeenEvent: false,
    };
    this.current = connection;
    const path = `/api/meetings/${this.meetingId}/events`;
    const response = await this.client.openStream(path, this.maxSeq, connection.controller.signal);
    if (response.status !== 200 || response.body === null)
      throw new StepFailure(`stream_status ${String(response.status)} on GET ${path}`);
    connection.body = response.body.getReader();
    void this.pump(connection);
  }

  // Reads the body of one connection until it ends. A drop that this reader did not cause is counted and retried.
  private async pump(connection: Connection): Promise<void> {
    const reader = connection.body;
    if (reader === undefined) return;
    try {
      await this.readBody(connection, reader);
    } catch {
      // A read that fails after this reader ended the connection is expected. Any other end is a drop, handled below.
    }
    if (!connection.isIntentional) this.scheduleUnplanned();
  }

  // Reads chunks until the body ends or this reader ends the connection, and hands every complete frame to handleFrame.
  private async readBody(
    connection: Connection,
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let pending = "";
    while (!connection.isIntentional) {
      const chunk = await reader.read();
      if (chunk.done) return;
      this.firstByte ??= Date.now() - (this.startedAt ?? Date.now());
      pending = this.consume(pending + decoder.decode(chunk.value, { stream: true }), connection);
    }
  }

  // Splits text into complete frames, handles each one, and returns the unfinished tail for the next chunk.
  private consume(text: string, connection: Connection): string {
    const frames = text.split("\n\n");
    const tail = frames.pop() ?? "";
    for (const frame of frames) {
      if (connection.isIntentional) break;
      this.handleFrame(frame, connection);
    }
    return tail;
  }

  // Routes one frame to the delta or committed handler. A comment-only frame carries no event.
  private handleFrame(text: string, connection: Connection): void {
    const frame = parseFrame(text);
    if (frame.isHeartbeat) this.firstHeartbeat ??= Date.now() - (this.startedAt ?? Date.now());
    if (frame.event === undefined) return;
    if (frame.event === "turn.delta") {
      this.handleDelta(frame.id, frame.data);
    } else {
      this.handleCommitted(frame.data, connection);
    }
  }

  // A delta has no id line. It is checked, kept and passed to the waiters.
  private handleDelta(id: string | undefined, data: string): void {
    if (id !== undefined) {
      this.raise("delta_has_id: a turn.delta frame carried an id line, which D47 forbids.");
      return;
    }
    const raw = parseObject(data);
    if (raw === undefined) {
      this.raise("event_schema_mismatch: a turn.delta frame is not a JSON object.");
      return;
    }
    if (raw.v !== EVENT_VERSION) {
      this.raise(`event_version_mismatch on turn.delta v=${show(raw.v)}`);
      return;
    }
    const parsed = TurnDelta.safeParse(raw);
    if (!parsed.success) {
      this.raise(`event_schema_mismatch on turn.delta: ${parsed.error.message.slice(0, 200)}`);
      return;
    }
    this.deltaList.push(parsed.data);
    this.accept(parsed.data);
  }

  // A committed event carries a version and a seq. The version is checked before the schema, so a new version is named as one.
  private handleCommitted(data: string, connection: Connection): void {
    const raw = parseObject(data);
    if (raw === undefined) {
      this.raise("event_schema_mismatch: a committed event is not a JSON object.");
      return;
    }
    if (raw.v !== EVENT_VERSION) {
      this.raise(`event_version_mismatch seq=${show(raw.seq)} v=${show(raw.v)}`);
      return;
    }
    const parsed = CommittedEvent.safeParse(raw);
    if (!parsed.success) {
      this.raise(
        `event_schema_mismatch seq=${show(raw.seq)} type=${show(raw.type)}: ${parsed.error.message.slice(0, 200)}`,
      );
      return;
    }
    this.acceptCommitted(parsed.data, connection);
  }

  // Keeps one committed event. A seq at or below the highest seen is a duplicate; the first event after a reconnect must follow on.
  private acceptCommitted(event: CommittedEvent, connection: Connection): void {
    const isFirstOfConnection = !connection.hasSeenEvent;
    connection.hasSeenEvent = true;
    if (event.seq <= this.maxSeq) {
      this.raise(`replay_duplicate seq=${String(event.seq)}`);
    } else if (isFirstOfConnection && this.maxSeq > 0 && event.seq !== this.maxSeq + 1) {
      this.raise(`replay_off_by_one expected=${String(this.maxSeq + 1)} got=${String(event.seq)}`);
    }
    this.seen.push(event);
    this.maxSeq = Math.max(this.maxSeq, event.seq);
    this.accept(event);
    if (this.options.plannedDisconnectAtSeq === event.seq && !this.isPlannedDone)
      this.plannedDisconnect(connection);
  }

  // Records an event in arrival order and hands it to every waiter whose predicate it matches.
  private accept(event: MeetingEvent): void {
    this.arrivalLog.push(event);
    const matched = this.waiters.filter((waiter) => waiter.predicate(event));
    this.waiters = this.waiters.filter((waiter) => !matched.includes(waiter));
    for (const waiter of matched) waiter.resolve(event);
  }

  // Records a problem and rejects every waiter with it.
  private raise(problem: string): void {
    this.problems.push(problem);
    const waiting = this.waiters;
    this.waiters = [];
    for (const waiter of waiting) waiter.reject(new StepFailure(problem));
  }

  // Ends the connection on purpose at the planned seq, then reopens it after the planned delay. The reopen is not counted as a drop.
  private plannedDisconnect(connection: Connection): void {
    this.isPlannedDone = true;
    this.interrupt(connection);
    setTimeout(() => {
      this.reconnect();
    }, PLANNED_RECONNECT_MS);
  }

  // Ends a connection that this reader chose to end, so its end is not read as a drop.
  private interrupt(connection: Connection): void {
    connection.isIntentional = true;
    connection.controller.abort();
    void connection.body?.cancel().catch(() => undefined);
  }

  // Reopens after a drop, with backoff. More than five drops is a failure, not a retry loop.
  private scheduleUnplanned(): void {
    if (this.isStopped) return;
    this.unplannedCount += 1;
    if (this.unplannedCount > MAX_UNPLANNED_RECONNECTS) {
      this.raise(
        `stream_dropped_5_times: the event stream dropped more than ${String(MAX_UNPLANNED_RECONNECTS)} times.`,
      );
      return;
    }
    const delay = reconnectDelayMs(this.unplannedCount - 1, () => Math.random());
    setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  // Opens a new connection unless the caller has closed the reader; a failure to open is recorded as a problem.
  private reconnect(): void {
    if (this.isStopped) return;
    void this.connect().catch((error: unknown) => {
      if (!this.isStopped) this.raise(describeError(error));
    });
  }
}
