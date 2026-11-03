import { z } from "zod";
import { PollResponse, routes } from "@meet-first/contracts";
import { apiFetch } from "../app-shell/index.js";
import type { PollReply } from "../transcript/event-fold.js";

// The poll reply read leniently: v, the raw events, the running partial and serverNow, so one unreadable event cannot hide the rest.
export const PollEnvelope = z.object({ v: z.number(), events: z.array(z.unknown()), partial: PollResponse.shape.partial, serverNow: z.string() });

// One GET /api/meetings/:id/events?after=<seq>, returned in the shape foldPollReply takes.
export async function pollEventsOnce(request: { meetingId: string; afterSeq: number; fetchImpl?: typeof fetch; origin?: string }): Promise<PollReply> {
  const options = {
    params: { id: request.meetingId },
    query: { after: request.afterSeq },
    replySchema: PollEnvelope,
    ...(request.fetchImpl === undefined ? {} : { fetchImpl: request.fetchImpl }),
    ...(request.origin === undefined ? {} : { origin: request.origin }),
  };
  return apiFetch(routes.meetings.events, options);
}

// A started loop polls now and every intervalMs; runOnce polls now unless a poll is already out.
export type Poller = { start: () => void; stop: () => void; runOnce: () => Promise<void>; isRunning: () => boolean };

// Builds a poll loop around one poll function.
export function createPoller(options: { poll: () => Promise<void>; intervalMs: number }): Poller {
  let isRunningFlag = false;
  let isPollOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const runOnce = async (): Promise<void> => {
    if (isPollOut) return;
    isPollOut = true;
    try {
      await options.poll();
    } catch {
      // The next tick tries again, so a failed poll is not reported here.
    }
    isPollOut = false;
  };

  const tick = (): void => {
    if (!isRunningFlag) return;
    timer = setTimeout(tick, options.intervalMs);
    void runOnce();
  };

  const stop = (): void => {
    isRunningFlag = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    start: () => {
      if (isRunningFlag) return;
      isRunningFlag = true;
      tick();
    },
    stop,
    runOnce,
    isRunning: () => isRunningFlag,
  };
}
