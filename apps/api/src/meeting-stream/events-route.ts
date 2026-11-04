import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ContractError, HTTP, routes } from "@meet-first/contracts";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makeSessionMissingError } from "../route-errors.js";
import { findPersonForSessionHash } from "../sessions/cookie.js";
import { requirePerson } from "../sessions/index.js";
import { MAX_INT_COLUMN, type FanOut } from "./listen-fan-out.js";
import { readPollResponse, type StreamReads } from "./replay-and-poll.js";
import {
  connectionKey,
  createSubscriber,
  SSE_HEADERS,
  SSE_PADDING,
  type ConnectionLimit,
  type StreamTiming,
  type Subscriber,
} from "./subscriber.js";

// A seq as text: 0, or a whole number with no leading zero, at most ten digits.
export const SEQ_TEXT_PATTERN = /^(0|[1-9][0-9]{0,9})$/;
// The :id parameter of the stream. A value that is not a uuid is not_found; the schema is local because contracts has no params schemas.
export const MeetingParams = z.object({ id: z.string().uuid() });
// The query: ?after=n switches the route to the JSON poll. A repeated after is an array, which fails this schema.
export const EventsQuery = z.object({ after: z.string().optional() });
// The parts one process shares across its streams.
export type StreamParts = {
  fanOut: FanOut;
  connections: ConnectionLimit<Subscriber>;
  reads: StreamReads;
  timing: StreamTiming;
};

// Reads a seq from text; null when it is not a whole number between 0 and MAX_INT_COLUMN.
export function readSeqText(text: string): number | null {
  return SEQ_TEXT_PATTERN.test(text) && Number(text) <= MAX_INT_COLUMN ? Number(text) : null;
}

// Reads Last-Event-ID: absent is 0, so the stream replays from the start; a seq is that seq; anything else is last_event_id_invalid.
export function readLastEventId(header: string | string[] | undefined): number {
  if (header === undefined) {
    return 0;
  }
  const seq = typeof header === "string" ? readSeqText(header) : null;
  if (seq === null) {
    throw new ContractError(
      "last_event_id_invalid",
      "The Last-Event-ID header must be a whole number. Reconnect without it to replay from the start.",
      HTTP.badRequest,
    );
  }
  return seq;
}

// The error for an after value that is not a whole number.
function makePollAfterInvalidError(): ContractError {
  return new ContractError(
    "poll_after_invalid",
    "The after value must be a whole number. Poll with the last seq you received.",
    HTTP.badRequest,
  );
}

// What one stream needs from its request, to open, to re-check and to close.
type StreamInput = {
  request: FastifyRequest;
  reply: FastifyReply;
  parts: StreamParts;
  deps: RouteDeps;
  meetingId: string;
  personId: string;
  lastSeq: number;
  sessionHash: Buffer;
};

// True while the session that opened the stream still belongs to this person, and the person is still in a meeting
// that is not deleted. Two reads: the session hash through auth_person_for_session, and the
// membership and the meeting's state in withPerson.
async function stillAllowed(input: {
  deps: RouteDeps;
  parts: StreamParts;
  sessionHash: Buffer;
  personId: string;
  meetingId: string;
}): Promise<boolean> {
  const holder = await findPersonForSessionHash(input.deps.db, input.sessionHash);
  if (holder !== input.personId) {
    return false;
  }
  const membership = await input.parts.reads.readMembership(input.personId, input.meetingId);
  return membership !== null && membership.state !== "deleted";
}

// Writes the padding and wires the subscriber to the response, the fan-out, the connection limit and the session
// re-check.
function openStream(input: StreamInput): void {
  const { request, reply, parts, deps, meetingId, personId, lastSeq, sessionHash } = input;
  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);
  reply.raw.write(SSE_PADDING);
  const write = (chunk: string): void => {
    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      reply.raw.write(chunk);
    }
  };
  const key = connectionKey(personId, meetingId);
  // end runs only after the subscriber below exists, because it is called by a check or by the connection limit.
  const end = (): void => {
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
    parts.connections.release(key, subscriber);
  };
  const subscriber: Subscriber = createSubscriber({
    personId,
    meetingId,
    lastSeq,
    reads: parts.reads,
    write,
    end,
    now: deps.now,
    log: request.log,
    timing: parts.timing,
    sessionStillValid: () => stillAllowed({ deps, parts, sessionHash, personId, meetingId }),
  });
  parts.connections.admit(key, subscriber);
  const unsubscribe = parts.fanOut.subscribe(meetingId, (signal) => {
    subscriber.wake(signal);
  });
  reply.raw.on("close", () => {
    subscriber.stop();
    unsubscribe();
    parts.connections.release(key, subscriber);
  });
  subscriber.start();
}

// Registers GET /api/meetings/:id/events: the SSE stream, or the JSON poll when ?after= is present.
export function registerEventsRoute(
  app: FastifyInstance,
  deps: RouteDeps,
  parts: StreamParts,
): void {
  app.get(routes.meetings.events.path, async (request, reply) => {
    const personId = requirePerson(request);
    const sessionHash = request.sessionTokenHash;
    if (sessionHash === null) {
      throw makeSessionMissingError();
    }
    const params = MeetingParams.safeParse(request.params);
    if (!params.success) {
      throw makeNotFoundError();
    }
    const meetingId = params.data.id.toLowerCase();
    const query = EventsQuery.safeParse(request.query);
    if (!query.success) {
      throw makePollAfterInvalidError();
    }
    const membership = await parts.reads.readMembership(personId, meetingId);
    if (membership === null || membership.state === "deleted") {
      throw makeNotFoundError();
    }
    if (query.data.after !== undefined) {
      const afterSeq = readSeqText(query.data.after);
      if (afterSeq === null) {
        throw makePollAfterInvalidError();
      }
      const body = await readPollResponse(parts.reads, {
        personId,
        meetingId,
        afterSeq,
        now: deps.now(),
      });
      await parts.reads.touchPresence(personId, meetingId);
      return reply.code(200).send(body);
    }
    const lastSeq = readLastEventId(request.headers["last-event-id"]);
    openStream({ request, reply, parts, deps, meetingId, personId, lastSeq, sessionHash });
  });
}
