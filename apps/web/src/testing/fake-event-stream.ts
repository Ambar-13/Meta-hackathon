import type { MeetingEvent } from "@meet-first/contracts";
import { emptyMeetingState, type MeetingFoldState } from "../transcript/event-fold.js";
import type { FeedStatus, MeetingFeed, MeetingFeedOptions } from "../streaming/sse-client.js";
import { IDS } from "./fixtures.js";

// One scripted stream connection: frames that then end or hang, a silent stream, or an error status.
export type FakeStream =
  | { kind: "frames"; chunks: string[]; then: "end" | "hang" }
  | { kind: "silent" }
  | { kind: "status"; status: number; body: unknown };
// A fake fetch for the meeting routes, and the requests it saw.
export type FakeMeetingServer = {
  fetchImpl: typeof fetch;
  streamRequests: Array<{ url: string; lastEventId: string | null }>;
  pollRequests: Array<{ url: string; after: string | null }>;
};

// The response a stream script gives: an error status, a silent stream, or the frames it lists.
function streamResponse(script: FakeStream | undefined, signal: AbortSignal | null): Response {
  if (script === undefined || script.kind === "silent") {
    return new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (script.kind === "status") {
    return new Response(JSON.stringify(script.body), {
      status: script.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of script.chunks) controller.enqueue(encoder.encode(chunk));
      if (script.then === "end") controller.close();
      signal?.addEventListener("abort", () => {
        controller.error(new DOMException("aborted", "AbortError"));
      });
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

// Builds the fake server: stream opens take the next script in order (the last repeats); polls take the next reply in order (the last repeats).
export function fakeMeetingServer(streams: FakeStream[], polls: unknown[]): FakeMeetingServer {
  const streamRequests: FakeMeetingServer["streamRequests"] = [];
  const pollRequests: FakeMeetingServer["pollRequests"] = [];
  let streamCount = 0;
  let pollCount = 0;
  // Answers one request synchronously; the fake fetch wraps the answer in a resolved promise.
  const answer = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = new URL(String(input));
    if (url.searchParams.has("after")) {
      pollRequests.push({ url: url.href, after: url.searchParams.get("after") });
      const reply = polls[Math.min(pollCount, polls.length - 1)];
      pollCount += 1;
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    streamRequests.push({
      url: url.href,
      lastEventId: new Headers(init?.headers).get("Last-Event-ID"),
    });
    const script = streams[Math.min(streamCount, streams.length - 1)];
    streamCount += 1;
    return streamResponse(script, init?.signal ?? null);
  };
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    Promise.resolve(answer(input, init))) as typeof fetch;
  return { fetchImpl, streamRequests, pollRequests };
}

// One SSE frame as the api writes it: id, event and data lines for a committed event; event and data only for turn.delta.
export function sseFrame(event: MeetingEvent): string {
  if (event.type === "turn.delta") return `event: turn.delta\ndata: ${JSON.stringify(event)}\n\n`;
  return `id: ${String(event.seq)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// A fake feed: hands the screen's callbacks to the test, which then pushes states and statuses.
export function fakeMeetingFeed(): {
  openFeed: (options: MeetingFeedOptions) => MeetingFeed;
  push: (state: MeetingFoldState, status: FeedStatus) => void;
  openCount: () => number;
} {
  let options: MeetingFeedOptions | null = null;
  let lastState: MeetingFoldState = emptyMeetingState(IDS.meeting);
  let lastStatus: FeedStatus = "connecting";
  let opened = 0;
  const openFeed = (next: MeetingFeedOptions): MeetingFeed => {
    options = next;
    opened += 1;
    return {
      close: () => undefined,
      currentState: () => lastState,
      currentStatus: () => lastStatus,
    };
  };
  const push = (state: MeetingFoldState, status: FeedStatus): void => {
    lastState = state;
    lastStatus = status;
    options?.onState(state, status);
  };
  return { openFeed, push, openCount: () => opened };
}
