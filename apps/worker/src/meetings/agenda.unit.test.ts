import { expect, it } from "vitest";
import {
  MEETING_TOKEN_STOP,
  isOverTokenStop,
  nextStep,
  sideForStep,
  startsNewPhase,
} from "./agenda.js";

// The fake clock's start: the first moment of the meeting in these tests.
const T0 = new Date("2026-10-27T03:00:00.000Z");
// The moment n minutes after T0.
function min(n: number): Date {
  return new Date(T0.getTime() + n * 60_000);
}

it("D34-T1: steps 1 and 2 are open, side a then side b", () => {
  expect(nextStep({ lastStepSeq: 1, phases: ["open"], startedAt: T0 }, min(1))).toEqual({
    kind: "step",
    stepSeq: 2,
    side: "b",
    phase: "open",
  });
});

it("D34-T2: after both open turns and before 8 minutes, step 3 is explore on side a", () => {
  expect(nextStep({ lastStepSeq: 2, phases: ["open", "open"], startedAt: T0 }, min(2))).toEqual({
    kind: "step",
    stepSeq: 3,
    side: "a",
    phase: "explore",
  });
});

it("D34-T3: after six explore turns the next step is decide", () => {
  const phases = [
    "open",
    "open",
    "explore",
    "explore",
    "explore",
    "explore",
    "explore",
    "explore",
  ] as const;
  expect(nextStep({ lastStepSeq: 8, phases: [...phases], startedAt: T0 }, min(5))).toEqual({
    kind: "step",
    stepSeq: 9,
    side: "a",
    phase: "decide",
  });
});

it("D34-T4: once a decide step exists, explore never comes back", () => {
  expect(
    nextStep({ lastStepSeq: 3, phases: ["open", "open", "decide"], startedAt: T0 }, min(1)),
  ).toEqual({ kind: "step", stepSeq: 4, side: "b", phase: "decide" });
});

it("D34-T5: odd steps are side a and even steps side b", () => {
  expect([sideForStep(1), sideForStep(2), sideForStep(9), sideForStep(10)]).toEqual([
    "a",
    "b",
    "a",
    "b",
  ]);
});

it("D34-T6: a new phase starts exactly when the next step's phase differs", () => {
  const explore = { kind: "step", stepSeq: 3, side: "a", phase: "explore" } as const;
  expect(startsNewPhase("open", explore)).toBe(true);
  expect(startsNewPhase("explore", explore)).toBe(false);
  expect(startsNewPhase("decide", { kind: "end" })).toBe(false);
});

it("R5.8-T1: at 8 minutes from the start the next step is decide, and 1 ms earlier it is explore", () => {
  const phases = ["open", "open", "explore"] as const;
  expect(nextStep({ lastStepSeq: 3, phases: [...phases], startedAt: T0 }, min(8))).toEqual({
    kind: "step",
    stepSeq: 4,
    side: "b",
    phase: "decide",
  });
  expect(
    nextStep(
      { lastStepSeq: 3, phases: [...phases], startedAt: T0 },
      new Date(min(8).getTime() - 1),
    ),
  ).toEqual({ kind: "step", stepSeq: 4, side: "b", phase: "explore" });
});

it("R5.8-T2: decide always runs both turns and then the meeting ends", () => {
  const afterOpen = nextStep({ lastStepSeq: 2, phases: ["open", "open"], startedAt: T0 }, min(20));
  const afterFirstDecide = nextStep(
    { lastStepSeq: 3, phases: ["open", "open", "decide"], startedAt: T0 },
    min(20),
  );
  const afterSecondDecide = nextStep(
    { lastStepSeq: 4, phases: ["open", "open", "decide", "decide"], startedAt: T0 },
    min(20),
  );
  expect(afterOpen).toEqual({ kind: "step", stepSeq: 3, side: "a", phase: "decide" });
  expect(afterFirstDecide).toEqual({ kind: "step", stepSeq: 4, side: "b", phase: "decide" });
  expect(afterSecondDecide).toEqual({ kind: "end" });
});

it("D61-T1: 1,499,999 tokens is under the stop and 1,500,000 is over it", () => {
  expect(isOverTokenStop(1_499_999)).toBe(false);
  expect(isOverTokenStop(1_500_000)).toBe(true);
  expect(MEETING_TOKEN_STOP).toBe(1_500_000);
});
