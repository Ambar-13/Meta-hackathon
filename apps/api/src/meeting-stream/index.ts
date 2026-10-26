// The meeting-stream folder: GET /api/meetings/:id/events as a stream or a poll, over one LISTEN connection per process (D48 to D53).
import { CONNECTIONS_PER_PERSON_PER_MEETING } from "@meet-first/contracts";
import type { RoutePlugin } from "../app-types.js";
import { registerEventsRoute } from "./events-route.js";
import { startListenFanOut } from "./listen-fan-out.js";
import { makeStreamReads } from "./replay-and-poll.js";
import { makeConnectionLimit, STREAM_TIMING, type StreamTiming, type Subscriber } from "./subscriber.js";

// The stream routes as one plugin for server.ts slot 7 with the given timing: starts this process's LISTEN connection,
// and ends every open stream and the connection before the server closes, because open streams would keep it from
// closing (seams S2, D51, D56). The server uses STREAM_TIMING; a test may pass a shorter session re-check interval.
export function meetingStreamRoutes(timing: StreamTiming): RoutePlugin {
  return async (app, deps) => {
    const fanOut = await startListenFanOut({ connectionString: deps.env.DATABASE_URL_API, log: app.log });
    const connections = makeConnectionLimit<Subscriber>(CONNECTIONS_PER_PERSON_PER_MEETING);
    app.addHook("preClose", async () => {
      connections.endAll();
      await fanOut.stop();
    });
    registerEventsRoute(app, deps, { fanOut, connections, reads: makeStreamReads(deps), timing });
  };
}

// The stream routes as one plugin for server.ts slot 7, with the timing every real stream uses.
export const registerMeetingStreamRoutes: RoutePlugin = meetingStreamRoutes(STREAM_TIMING);
