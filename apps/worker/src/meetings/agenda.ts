// The meeting agenda: open is 2 turns, explore up to 6, decide 2, then the meeting ends.
// Turns alternate sides, explore stops at 8 minutes from the start, and decide always runs.
import { AGENDA, EXPLORE_CUTOFF_MINUTES } from "@meet-first/contracts";

// Tokens one meeting may use before it ends with reason budget.
export const MEETING_TOKEN_STOP = 1_500_000;

// The most turns a meeting can have: 2 open, 6 explore, 2 decide.
export const MEETING_TURNS_MAX = AGENDA.open + AGENDA.exploreMax + AGENDA.decide;

// The phases a step can be in. Close is not a model turn; it is meeting.ended.
export type StepPhase = "open" | "explore" | "decide";

// What the agenda reads about a running meeting: the last committed step, the phases of all committed steps in order, the start.
export type AgendaProgress = { lastStepSeq: number; phases: readonly StepPhase[]; startedAt: Date };

// The step to create next, or the end of the meeting.
export type NextStep = { kind: "step"; stepSeq: number; side: "a" | "b"; phase: StepPhase } | { kind: "end" };

// Odd steps are side a and even steps side b, so turns strictly alternate.
export function sideForStep(stepSeq: number): "a" | "b" {
  return stepSeq % 2 === 1 ? "a" : "b";
}

// Places the step after the last committed one, from the phases so far and the clock at commit time.
export function nextStep(progress: AgendaProgress, now: Date): NextStep {
  const count = (phase: StepPhase): number => progress.phases.filter((done) => done === phase).length;
  const stepSeq = progress.lastStepSeq + 1;
  const side = sideForStep(stepSeq);
  const cutoffMs = progress.startedAt.getTime() + EXPLORE_CUTOFF_MINUTES * 60_000;
  if (count("open") < AGENDA.open) return { kind: "step", stepSeq, side, phase: "open" };
  const isExploreOpen = count("decide") === 0 && count("explore") < AGENDA.exploreMax && now.getTime() < cutoffMs;
  if (isExploreOpen) return { kind: "step", stepSeq, side, phase: "explore" };
  if (count("decide") < AGENDA.decide) return { kind: "step", stepSeq, side, phase: "decide" };
  return { kind: "end" };
}

// True when the step being created starts a new phase, which is when phase.changed is written.
export function startsNewPhase(lastPhase: StepPhase | null, next: NextStep): boolean {
  return next.kind === "step" && next.phase !== lastPhase;
}

// True when the meeting's tokens so far reach the meeting's token stop.
export function isOverTokenStop(tokensUsed: number): boolean {
  return tokensUsed >= MEETING_TOKEN_STOP;
}
