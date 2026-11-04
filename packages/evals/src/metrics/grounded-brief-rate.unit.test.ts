// Unit tests for the grounded brief rate: it recomputes the quote check and never trusts the stored
// flag alone.
import { describe, expect, it } from "vitest";
import { normQuote } from "@meet-first/receipts";
import type { BriefLineRow, EvalRows, TurnTextRow } from "../collect-rows.js";
import { measureGroundedBriefRate } from "./grounded-brief-rate.js";

const QUESTION = "How do we split money if one of us does more of the work this month?";
const TEXT_A = "I keep my notes in plain text files on my laptop every week.";
const TEXT_STRAIGHT = "I'm keeping my notes in plain text files on my laptop every week.";
const TEXT_B = "We agreed that the weekly review happens on Sunday evening at home.";

// A turn row whose normalised text is computed the way the product stores it.
function turn(turnId: string, personId: string, text: string): TurnTextRow {
  return { turnId, personId, text, normText: normQuote(text) };
}

// One brief line with the quotes it rests on.
function line(quotes: BriefLineRow["point"]["quotes"]): BriefLineRow {
  return {
    meetingId: "m1",
    personId: "pa",
    section: "agree",
    point: { text: "A line.", quotes, supported: true },
  };
}

describe("grounded brief rate", () => {
  it("W2-EVAL-T2 (R3.2): grounded brief rate recomputes verifyQuote and needs every quote verified in the right side's turn", () => {
    const turns = new Map<string, TurnTextRow>([
      ["t1", turn("t1", "pa", TEXT_A)],
      ["t2", turn("t2", "pa", TEXT_STRAIGHT)],
      ["t3", turn("t3", "pb", TEXT_B)],
    ]);
    const lines = [
      // 1. exact quote from A's own turn: grounded
      line([
        { text: "I keep my notes in plain text files", side: "a", turnId: "t1", verified: true },
      ]),
      // 2. curly apostrophe in the quote, straight one in the turn: grounded
      line([
        {
          text: "I’m keeping my notes in plain text files",
          side: "a",
          turnId: "t2",
          verified: true,
        },
      ]),
      // 3. stored verified true, but the words were changed: not grounded
      line([
        {
          text: "I keep my notes in plain text files on my tablet",
          side: "a",
          turnId: "t1",
          verified: true,
        },
      ]),
      // 4. right words, but the turn belongs to B while the quote says side a: not grounded
      line([
        { text: "I keep my notes in plain text files", side: "a", turnId: "t3", verified: true },
      ]),
      // 5. no quotes at all: not grounded
      line([]),
      // 6. two quotes, both good: grounded
      line([
        { text: "I keep my notes in plain text files", side: "a", turnId: "t1", verified: true },
        { text: "on my laptop every week", side: "a", turnId: "t1", verified: true },
      ]),
    ];
    const rows: EvalRows = {
      claims: [],
      briefMeta: [],
      events: [],
      meetings: [],
      ledger: [],
      plantedMarkers: [],
      briefLines: lines,
      turns,
      questionByMeeting: new Map([["m1", QUESTION]]),
      personBySide: new Map([["m1", { a: "pa", b: "pb" }]]),
    };
    const result = measureGroundedBriefRate(rows);
    expect(result.value).toBeCloseTo(0.5, 10);
    expect(result.n).toBe(6);
    expect(result.display).toBe("0.500");
  });
});
