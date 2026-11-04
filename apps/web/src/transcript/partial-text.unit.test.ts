import { describe, expect, it } from "vitest";
import { applyDelta, type PartialTurn } from "./partial-text.js";
import { turnDelta } from "../testing/fixtures.js";

// A partial turn of side a at the given step and attempt.
function p(stepSeq: number, attempt: number, text: string): PartialTurn {
  return { stepSeq, attempt, side: "a", text };
}

describe("partial text rule", () => {
  it("D47-T2: a delta at the current length appends", () => {
    expect(
      applyDelta(
        p(1, 1, "Hel"),
        turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 3, text: "lo" }),
        0,
      ),
    ).toEqual({ kind: "apply", partial: p(1, 1, "Hello") });
  });

  it("D47-T3: a newer attempt replaces the partial at offset 0 and asks for a resync at any other offset", () => {
    expect(
      applyDelta(
        p(1, 1, "Hello"),
        turnDelta({ stepSeq: 1, attempt: 2, side: "a", offset: 0, text: "Hi" }),
        0,
      ),
    ).toEqual({ kind: "apply", partial: p(1, 2, "Hi") });
    expect(
      applyDelta(
        p(1, 1, "Hello"),
        turnDelta({ stepSeq: 1, attempt: 2, side: "a", offset: 5, text: "Hi" }),
        0,
      ),
    ).toEqual({ kind: "resync" });
  });

  it("D47-T4: a delta at a wrong offset asks for a resync", () => {
    expect(
      applyDelta(
        p(1, 1, "0123456789"),
        turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 12, text: "x" }),
        0,
      ),
    ).toEqual({ kind: "resync" });
  });

  it("D47-T5: deltas for a committed step, an older step or an older attempt are ignored", () => {
    expect(
      applyDelta(
        p(2, 1, "a"),
        turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 0, text: "x" }),
        1,
      ),
    ).toEqual({ kind: "ignore" });
    expect(
      applyDelta(
        p(3, 1, "a"),
        turnDelta({ stepSeq: 2, attempt: 1, side: "a", offset: 0, text: "x" }),
        0,
      ),
    ).toEqual({ kind: "ignore" });
    expect(
      applyDelta(
        p(2, 2, "a"),
        turnDelta({ stepSeq: 2, attempt: 1, side: "a", offset: 1, text: "x" }),
        0,
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("R8.3-T2: offset 0 on the same attempt replaces the partial, as a new connection resends the text so far", () => {
    expect(
      applyDelta(
        p(1, 1, "Hello"),
        turnDelta({ stepSeq: 1, attempt: 1, side: "a", offset: 0, text: "Hello wor" }),
        0,
      ),
    ).toEqual({ kind: "apply", partial: p(1, 1, "Hello wor") });
  });

  it("D47-T6: the first delta of a new step starts the partial at offset 0 and asks for a resync at any other offset", () => {
    expect(
      applyDelta(null, turnDelta({ stepSeq: 2, attempt: 1, side: "b", offset: 0, text: "Hi" }), 1),
    ).toEqual({ kind: "apply", partial: { stepSeq: 2, attempt: 1, side: "b", text: "Hi" } });
    expect(
      applyDelta(null, turnDelta({ stepSeq: 2, attempt: 1, side: "b", offset: 4, text: "Hi" }), 1),
    ).toEqual({ kind: "resync" });
  });
});
