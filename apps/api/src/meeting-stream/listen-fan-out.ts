import pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { RECONNECT } from "@meet-first/contracts";

// The one NOTIFY channel.
export const LISTEN_CHANNEL = "meeting_events";
// The application_name of the LISTEN connection, so a test or an operator can find it in pg_stat_activity.
export const LISTEN_APPLICATION_NAME = "meet-first-listen";
// The largest value a Postgres int column holds (seq, step_seq, attempt and partial_len are int columns); a number above it is not a real payload.
export const MAX_INT_COLUMN = 2_147_483_647;
// How long one connect attempt may take before it counts as failed: 5 s, the pool's connectionTimeoutMillis in the database spec 4.1 (node-pg waits forever by default, which would stop the api from booting).
export const LISTEN_CONNECT_TIMEOUT_MS = 5_000;

// One parsed NOTIFY payload: a committed event, or a flush of a running step's partial text.
export type ListenPayload = { kind: "event"; meetingId: string; seq: number } | { kind: "delta"; meetingId: string; stepSeq: number; attempt: number; len: number };
// What wakes one stream: a payload for its meeting, or a poll (the 10 s safety poll, or a LISTEN reconnect).
export type WakeSignal = ListenPayload | { kind: "poll" };
// This process's LISTEN connection, as the streams see it.
export type FanOut = { subscribe: (meetingId: string, wake: (signal: WakeSignal) => void) => () => void; stop: () => Promise<void> };

// A seq as text: a whole number with no leading zero, at most ten digits.
const SEQ_TEXT = /^[1-9][0-9]{0,9}$/;
// A count as text: zero, or a whole number with no leading zero, at most ten digits.
const COUNT_TEXT = /^(0|[1-9][0-9]{0,9})$/;

// True when the text is a uuid, in either case.
function isUuid(text: string): boolean {
  return z.string().uuid().safeParse(text).success;
}

// Reads a whole number from text that has the given form, or null when it does not, or when it is over the int column limit.
function readIntText(text: string | undefined, form: RegExp): number | null {
  if (text === undefined || !form.test(text)) {
    return null;
  }
  const value = Number(text);
  return value <= MAX_INT_COLUMN ? value : null;
}

// Reads the rest of an e: payload, which is exactly one seq.
function parseEventPayload(meetingId: string, rest: string[]): ListenPayload | null {
  const seq = readIntText(rest[0], SEQ_TEXT);
  if (rest.length !== 1 || seq === null) {
    return null;
  }
  return { kind: "event", meetingId, seq };
}

// Reads the rest of a d: payload, which is the step seq, the attempt and the length.
function parseDeltaPayload(meetingId: string, rest: string[]): ListenPayload | null {
  const stepSeq = readIntText(rest[0], SEQ_TEXT);
  const attempt = readIntText(rest[1], COUNT_TEXT);
  const len = readIntText(rest[2], COUNT_TEXT);
  if (rest.length !== 3 || stepSeq === null || attempt === null || len === null) {
    return null;
  }
  return { kind: "delta", meetingId, stepSeq, attempt, len };
}

// Reads one payload: e:{meeting_id}:{seq} or d:{meeting_id}:{step_seq}:{attempt}:{len}; any other text is null and is ignored.
export function parseListenPayload(payload: string): ListenPayload | null {
  const [kind, meetingId, ...rest] = payload.split(":");
  if (meetingId === undefined || !isUuid(meetingId)) {
    return null;
  }
  const lowerId = meetingId.toLowerCase();
  if (kind === "e") {
    return parseEventPayload(lowerId, rest);
  }
  if (kind === "d") {
    return parseDeltaPayload(lowerId, rest);
  }
  return null;
}

// The wait before reconnect attempt n (0-based): 1 s doubling to a cap of 30 s, no jitter, because there is one connection per process (RECONNECT).
export function listenReconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT.capMs, RECONNECT.firstMs * RECONNECT.factor ** attempt);
}

// This process's one LISTEN connection and the streams waiting on it. Built only through startListenFanOut.
export class ListenFanOut implements FanOut {
  private readonly registry = new Map<string, Set<(signal: WakeSignal) => void>>();
  private current: pg.Client | null = null;
  private attempt = 0;
  private hasConnectedOnce = false;
  private isStopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: { connectionString: string; log: FastifyBaseLogger }) {}

  subscribe(meetingId: string, wake: (signal: WakeSignal) => void): () => void {
    const set = this.registry.get(meetingId) ?? new Set<(signal: WakeSignal) => void>();
    set.add(wake);
    this.registry.set(meetingId, set);
    return () => {
      set.delete(wake);
      // Only the set that is still registered is removed, so a late unsubscribe never drops a newer subscriber.
      if (set.size === 0 && this.registry.get(meetingId) === set) {
        this.registry.delete(meetingId);
      }
    };
  }

  // Opens the connection and listens on the channel. Never throws: a failure is logged and a retry is scheduled.
  async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.options.connectionString, application_name: LISTEN_APPLICATION_NAME, connectionTimeoutMillis: LISTEN_CONNECT_TIMEOUT_MS });
    client.on("notification", (message) => {
      this.deliver(message.channel, message.payload);
    });
    client.on("error", (error) => {
      this.drop(client, error);
    });
    client.on("end", () => {
      this.drop(client, null);
    });
    this.current = client;
    try {
      await client.connect();
      await client.query("LISTEN meeting_events");
    } catch (error) {
      this.options.log.warn({ code: "listen_connect_failed", err: error }, "listen_connect_failed");
      this.drop(client, error);
      return;
    }
    this.attempt = 0;
    this.options.log.info({ code: "listen_connected" }, "listen_connected");
    if (this.hasConnectedOnce) {
      this.wakeEveryStream();
    }
    this.hasConnectedOnce = true;
  }

  // Wakes every open stream with a poll, so a notice lost during a reconnect is read at once.
  private wakeEveryStream(): void {
    for (const wakes of this.registry.values()) {
      for (const wake of wakes) {
        wake({ kind: "poll" });
      }
    }
  }

  // Hands one notice to the streams of its meeting. Streams of other meetings never see it.
  private deliver(channel: string, payload: string | undefined): void {
    if (channel !== LISTEN_CHANNEL) {
      return;
    }
    const parsed = parseListenPayload(payload ?? "");
    if (parsed === null) {
      return;
    }
    for (const wake of this.registry.get(parsed.meetingId) ?? []) {
      wake(parsed);
    }
  }

  // Forgets a dropped connection and schedules a reconnect, unless the process is stopping.
  private drop(client: pg.Client, error: unknown): void {
    if (client !== this.current) {
      return;
    }
    this.current = null;
    client.removeAllListeners();
    client.on("error", () => undefined);
    void client.end().catch(() => undefined);
    if (this.isStopped) {
      return;
    }
    this.options.log.warn({ code: "listen_dropped", err: error }, "listen_dropped");
    this.scheduleReconnect();
  }

  // Waits the next backoff step, then connects again. Only one retry is ever pending.
  private scheduleReconnect(): void {
    if (this.timer !== null) {
      return;
    }
    const delay = listenReconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  // Closes the connection and cancels any pending retry, so the server can shut down.
  async stop(): Promise<void> {
    this.isStopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const client = this.current;
    this.current = null;
    if (client !== null) {
      client.removeAllListeners();
      client.on("error", () => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

// Opens the LISTEN connection, then returns the fan-out; a failed first attempt is retried in the background, so the api still boots.
export async function startListenFanOut(options: { connectionString: string; log: FastifyBaseLogger }): Promise<FanOut> {
  const fanOut = new ListenFanOut(options);
  await fanOut.connect();
  return fanOut;
}
