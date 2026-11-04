import type { TurnDelta } from "@meet-first/contracts";

// The turn being written: its step and attempt, whose side, and the text so far.
export type PartialTurn = {
  stepSeq: number;
  attempt: number;
  side: TurnDelta["side"];
  text: string;
};
// What to do with one delta: use the new partial, ignore it, or poll once to resync.
export type DeltaOutcome =
  | { kind: "apply"; partial: PartialTurn }
  | { kind: "ignore" }
  | { kind: "resync" };

// The outcome that starts the partial from a delta at offset 0, and asks for a resync at any other offset.
function startFrom(delta: TurnDelta): DeltaOutcome {
  if (delta.offset !== 0) return { kind: "resync" };
  return {
    kind: "apply",
    partial: { stepSeq: delta.stepSeq, attempt: delta.attempt, side: delta.side, text: delta.text },
  };
}

// A delta for the same step and attempt: it appends at the current length, or restarts the text at offset 0.
function sameAttempt(partial: PartialTurn, delta: TurnDelta): DeltaOutcome {
  if (delta.offset === partial.text.length) {
    return { kind: "apply", partial: { ...partial, text: partial.text + delta.text } };
  }
  return startFrom(delta);
}

// Appends a delta at the current length, replaces the partial at offset 0 or on a newer attempt, and asks for a resync otherwise.
export function applyDelta(
  partial: PartialTurn | null,
  delta: TurnDelta,
  lastCommittedStepSeq: number,
): DeltaOutcome {
  if (delta.stepSeq <= lastCommittedStepSeq) return { kind: "ignore" };
  if (partial === null || delta.stepSeq > partial.stepSeq) return startFrom(delta);
  if (delta.stepSeq < partial.stepSeq) return { kind: "ignore" };
  if (delta.attempt < partial.attempt) return { kind: "ignore" };
  if (delta.attempt > partial.attempt) return startFrom(delta);
  return sameAttempt(partial, delta);
}
