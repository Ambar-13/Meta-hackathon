import { POLL_MS, routes, SSE_FIRST_BYTE_MS } from "@meet-first/contracts";
import { ApiError, buildApiPath, errorFromResponse } from "../app-shell/index.js";
import { createPoller, pollEventsOnce, type Poller } from "./poll-fallback.js";
import { reconnectDelayMs, watchVisibility, type VisibilitySource } from "./reconnect-schedule.js";
import {
  emptyMeetingState,
  foldPollReply,
  foldRaw,
  type MeetingFoldState,
} from "../transcript/event-fold.js";

// One frame of the stream: its id, event and data lines; all three are null for a comment such as
// the heartbeat or the padding.
export type SseFrame = { id: string | null; event: string | null; data: string | null };
// The connection state a screen shows.
export type FeedStatus = "connecting" | "live" | "polling" | "reconnecting" | "closed";
// What openMeetingFeed needs: the meeting, two callbacks, and inputs that tests replace.
export type MeetingFeedOptions = {
  meetingId: string;
  onState: (state: MeetingFoldState, status: FeedStatus) => void;
  onStopped: (error: ApiError) => void;
  fetchImpl?: typeof fetch;
  random?: () => number;
  visibility?: VisibilitySource | null;
  origin?: string;
};
// An open feed: close it, or read its current state and status.
export type MeetingFeed = {
  close: () => void;
  currentState: () => MeetingFoldState;
  currentStatus: () => FeedStatus;
};

// Applies one line of a frame to it: id, event and data are kept, and any other field is ignored.
function applyField(frame: SseFrame, line: string): void {
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
  if (field === "id") frame.id = value;
  else if (field === "event") frame.event = value;
  else if (field === "data") frame.data = frame.data === null ? value : `${frame.data}\n${value}`;
}

// Splits one block of text lines into a frame, following the SSE field rules. Empty lines and
// comment lines are skipped.
function frameFromBlock(block: string): SseFrame {
  const frame: SseFrame = { id: null, event: null, data: null };
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line !== "" && !line.startsWith(":")) applyField(frame, line);
  }
  return frame;
}

// Splits buffered stream text into complete frames and returns the unfinished tail to keep for the
// next chunk.
export function parseSseText(buffer: string): { frames: SseFrame[]; rest: string } {
  const end = buffer.lastIndexOf("\n\n");
  if (end === -1) return { frames: [], rest: buffer };
  const complete = buffer.slice(0, end);
  const rest = buffer.slice(end + 2);
  return { frames: complete.split("\n\n").map(frameFromBlock), rest };
}

// Everything one open feed keeps between events; the functions below take it as their one argument.
type FeedContext = {
  meetingId: string;
  options: MeetingFeedOptions;
  fetchImpl: typeof fetch;
  random: () => number;
  origin: string;
  state: MeetingFoldState;
  status: FeedStatus;
  attempt: number;
  streamNumber: number;
  controller: AbortController | null;
  firstByteTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  isClosed: boolean;
  poller: Poller;
  stopWatching: () => void;
};

// Stores the new state and status, tells the screen, and asks for one resync poll when the fold
// needs one.
function publish(ctx: FeedContext, next: MeetingFoldState, nextStatus: FeedStatus): void {
  ctx.state = next;
  ctx.status = nextStatus;
  ctx.options.onState(ctx.state, ctx.status);
  if (ctx.state.resyncRequested && !ctx.isClosed) void ctx.poller.runOnce();
}

// The page origin, or a local one when no page exists (unit tests run in Node).
function originFor(options: MeetingFeedOptions): string {
  if (options.origin !== undefined) return options.origin;
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

// Clears the first-byte timer, if one is set.
function clearFirstByte(ctx: FeedContext): void {
  if (ctx.firstByteTimer !== null) clearTimeout(ctx.firstByteTimer);
  ctx.firstByteTimer = null;
}

// Starts polling at once: the stream has been silent too long.
function startPolling(ctx: FeedContext): void {
  publish(ctx, ctx.state, "polling");
  ctx.poller.start();
}

// The first byte on any stream ends polling and resets the backoff.
function gotBytes(ctx: FeedContext): void {
  clearFirstByte(ctx);
  ctx.attempt = 0;
  ctx.poller.stop();
  if (ctx.status !== "live") publish(ctx, ctx.state, "live");
}

// Applies one parsed frame; a frame without data is a comment and changes nothing.
function takeFrame(ctx: FeedContext, frame: SseFrame): void {
  if (frame.data === null) return;
  let raw: unknown;
  try {
    raw = JSON.parse(frame.data) as unknown;
  } catch {
    return;
  }
  publish(ctx, foldRaw(ctx.state, raw), ctx.status);
}

// Schedules the next connection after the backoff delay, unless this stream was replaced or the
// feed is closed.
function streamEnded(ctx: FeedContext, number: number): void {
  if (number !== ctx.streamNumber || ctx.isClosed) return;
  clearFirstByte(ctx);
  const delay = reconnectDelayMs(ctx.attempt, ctx.random);
  ctx.attempt += 1;
  if (ctx.status !== "polling") publish(ctx, ctx.state, "reconnecting");
  ctx.reconnectTimer = setTimeout(() => {
    openStream(ctx);
  }, delay);
}

// Reads chunks of one open stream until it ends, is replaced, or the feed closes.
async function pumpChunks(ctx: FeedContext, response: Response, number: number): Promise<void> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    streamEnded(ctx, number);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    if (number !== ctx.streamNumber || ctx.isClosed) {
      await reader.cancel();
      return;
    }
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      streamEnded(ctx, number);
      return;
    }
    if (chunk.done) {
      streamEnded(ctx, number);
      return;
    }
    gotBytes(ctx);
    buffer += decoder.decode(chunk.value, { stream: true });
    const parsed = parseSseText(buffer);
    buffer = parsed.rest;
    for (const frame of parsed.frames) takeFrame(ctx, frame);
  }
}

// Reads the reply of one stream connection: an auth or not-found status stops the feed, any other
// failure reconnects.
async function readStream(ctx: FeedContext, response: Response, number: number): Promise<void> {
  if (number !== ctx.streamNumber) return;
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    stopFeed(ctx, await errorFromResponse(response));
    return;
  }
  if (!response.ok || response.body === null) {
    streamEnded(ctx, number);
    return;
  }
  await pumpChunks(ctx, response, number);
}

// Opens one stream connection, replaying from the last committed seq and starting the first-byte
// timer.
function openStream(ctx: FeedContext): void {
  if (ctx.isClosed) return;
  ctx.streamNumber += 1;
  const number = ctx.streamNumber;
  ctx.controller?.abort();
  const controller = new AbortController();
  ctx.controller = controller;
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (ctx.state.lastSeq > 0) headers["Last-Event-ID"] = String(ctx.state.lastSeq);
  ctx.firstByteTimer = setTimeout(() => {
    startPolling(ctx);
  }, SSE_FIRST_BYTE_MS);
  const url = new URL(
    buildApiPath(routes.meetings.events.path, { id: ctx.meetingId }, {}),
    ctx.origin,
  );
  const init: RequestInit = {
    method: "GET",
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal: controller.signal,
  };
  ctx.fetchImpl(url, init).then(
    (response) => readStream(ctx, response, number),
    () => {
      streamEnded(ctx, number);
    },
  );
}

// Stops the feed for a reason the person must act on, and tells the screen.
function stopFeed(ctx: FeedContext, error: ApiError): void {
  closeFeed(ctx);
  ctx.options.onStopped(error);
}

// Closes the feed: aborts the stream, clears its timers and polling, and tells the screen it is
// closed.
function closeFeed(ctx: FeedContext): void {
  if (ctx.isClosed) return;
  ctx.isClosed = true;
  ctx.streamNumber += 1;
  ctx.controller?.abort();
  clearFirstByte(ctx);
  if (ctx.reconnectTimer !== null) clearTimeout(ctx.reconnectTimer);
  ctx.poller.stop();
  ctx.stopWatching();
  publish(ctx, ctx.state, "closed");
}

// One poll for the feed: folds the reply after the last seq; an auth or not-found error stops the
// feed.
async function pollAndFold(ctx: FeedContext): Promise<void> {
  try {
    const reply = await pollEventsOnce({
      meetingId: ctx.meetingId,
      afterSeq: ctx.state.lastSeq,
      fetchImpl: ctx.fetchImpl,
      origin: ctx.origin,
    });
    publish(ctx, foldPollReply(ctx.state, reply), ctx.status);
  } catch (thrown: unknown) {
    if (
      thrown instanceof ApiError &&
      (thrown.status === 401 || thrown.status === 403 || thrown.status === 404)
    )
      stopFeed(ctx, thrown);
  }
}

// Reopens the stream now when the page turns visible; the new stream replays from the last seq.
function reopenNow(ctx: FeedContext): void {
  if (ctx.isClosed) return;
  if (ctx.reconnectTimer !== null) clearTimeout(ctx.reconnectTimer);
  ctx.reconnectTimer = null;
  clearFirstByte(ctx);
  ctx.attempt = 0;
  openStream(ctx);
}

// The document the visibility watcher uses, unless the options give one (null means none).
function visibilityFor(options: MeetingFeedOptions): VisibilitySource | null {
  if (options.visibility !== undefined) return options.visibility;
  return typeof document === "undefined" ? null : (document as VisibilitySource);
}

// Opens the meeting stream and keeps one folded state: replay from the last seq, polling when the
// stream is silent, reconnects with backoff and on return from the background.
export function openMeetingFeed(options: MeetingFeedOptions): MeetingFeed {
  const source = visibilityFor(options);
  const ctx: FeedContext = {
    meetingId: options.meetingId,
    options,
    fetchImpl: options.fetchImpl ?? fetch,
    random: options.random ?? Math.random,
    origin: originFor(options),
    state: emptyMeetingState(options.meetingId),
    status: "connecting",
    attempt: 0,
    streamNumber: 0,
    controller: null,
    firstByteTimer: null,
    reconnectTimer: null,
    isClosed: false,
    poller: createPoller({ poll: () => pollAndFold(ctx), intervalMs: POLL_MS }),
    stopWatching: () => undefined,
  };
  ctx.stopWatching = watchVisibility(source, () => {
    reopenNow(ctx);
  });
  publish(ctx, ctx.state, "connecting");
  openStream(ctx);
  return {
    close: () => {
      closeFeed(ctx);
    },
    currentState: () => ctx.state,
    currentStatus: () => ctx.status,
  };
}
