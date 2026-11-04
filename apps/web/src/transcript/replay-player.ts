import { ContractError, type CommittedEvent, type ReplayExport } from "@meet-first/contracts";
import { emptyMeetingState, foldEvent, type MeetingFoldState } from "./event-fold.js";

// One event of a replay and when it plays, in milliseconds from the start.
export type ReplayStep = { atMs: number; event: CommittedEvent };

// When each event of an export plays: gaps between `at` times divided by speed.
export function replayTimeline(exported: ReplayExport, speed: number): ReplayStep[] {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new ContractError(
      "replay_speed_invalid",
      "Replay speed must be a number above 0, such as 1 or 4.",
    );
  }
  const sorted = [...exported.events].sort((first, second) => first.seq - second.seq);
  const steps: ReplayStep[] = [];
  let atMs = 0;
  sorted.forEach((event, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined)
      atMs += Math.max(0, Date.parse(event.at) - Date.parse(previous.at)) / speed;
    steps.push({ atMs, event });
  });
  return steps;
}

// Plays an export through foldEvent, calling onState after each event; returns the function that stops it.
export function playReplay(
  exported: ReplayExport,
  options: { speed: number; onState: (state: MeetingFoldState) => void },
): () => void {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let state = emptyMeetingState(exported.meetingId);
  for (const step of replayTimeline(exported, options.speed)) {
    timers.push(
      setTimeout(() => {
        state = foldEvent(state, step.event);
        options.onState(state);
      }, step.atMs),
    );
  }
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
