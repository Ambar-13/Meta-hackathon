import { describe, expect, it } from "vitest";
import type { BriefOutput, Claim } from "@meet-first/contracts";
import { normQuote } from "@meet-first/receipts";
import { readPrompt } from "@meet-first/prompts";
import {
  buildBriefPromptInput,
  verifyBriefQuotes,
  type ApprovedItem,
  type BriefSide,
  type SourceTurn,
  type TranscriptTurn,
} from "./brief-lines.js";

// The two sides of the test meeting, with fixed ids so the prompt text is the same on every run.
const SIDE_A: BriefSide = {
  side: "a",
  personId: "00000000-0000-4000-8000-000000000101",
  displayName: "Mira",
  cardId: "00000000-0000-4000-8000-000000000111",
};
const SIDE_B: BriefSide = {
  side: "b",
  personId: "00000000-0000-4000-8000-000000000102",
  displayName: "Jonah",
  cardId: "00000000-0000-4000-8000-000000000112",
};
// The question the meeting was held on.
const QUESTION = "How do you handle a missed deadline?";
// Turn texts of the two notes, each long enough to quote.
const TURN_A1 = "I always write the plan down before a big meeting so nobody guesses.";
const TURN_A2 = "Deadlines matter to me; when one slips I tell the team the same day.";
const TURN_B1 = "I don’t move a deadline without telling the team first.";
const TURN_B2 = "I like to think out loud with the team before I decide anything.";
// The source turns of the two notes, by side and index.
const SOURCE_TURNS: SourceTurn[] = [
  {
    id: "00000000-0000-4000-8000-000000000301",
    side: "a",
    personId: SIDE_A.personId,
    turnIndex: 1,
    text: TURN_A1,
    normText: normQuote(TURN_A1),
  },
  {
    id: "00000000-0000-4000-8000-000000000302",
    side: "a",
    personId: SIDE_A.personId,
    turnIndex: 2,
    text: TURN_A2,
    normText: normQuote(TURN_A2),
  },
  {
    id: "00000000-0000-4000-8000-000000000401",
    side: "b",
    personId: SIDE_B.personId,
    turnIndex: 1,
    text: TURN_B1,
    normText: normQuote(TURN_B1),
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    side: "b",
    personId: SIDE_B.personId,
    turnIndex: 2,
    text: TURN_B2,
    normText: normQuote(TURN_B2),
  },
];

// A claim as the turn.committed event carries it.
function claimOf(spec: {
  side: "a" | "b";
  position: number;
  turnId: string;
  quote: string;
  isVerified: boolean;
}): Claim {
  const { side, position, turnId, quote, isVerified } = spec;
  return {
    id: "00000000-0000-4000-8000-0000000009" + String(position),
    side,
    position,
    text: `Claim ${String(position)} of ${side}`,
    quote,
    gloss: `Gloss ${String(position)}`,
    lang: "en",
    turnId,
    verified: isVerified,
    flagged: !isVerified,
    evidenceValid: true,
  };
}

// One transcript turn with two claims: one verified, and one flagged as no receipt.
const TRANSCRIPT: TranscriptTurn[] = [
  {
    stepSeq: 1,
    side: "a",
    phase: "explore",
    text: "I plan first and I say so early.",
    claims: [
      claimOf({
        side: "a",
        position: 1,
        turnId: SOURCE_TURNS[0]?.id ?? "",
        quote: TURN_A1,
        isVerified: true,
      }),
    ],
  },
  {
    stepSeq: 3,
    side: "b",
    phase: "decide",
    text: "I think out loud before I commit.",
    claims: [
      claimOf({
        side: "b",
        position: 1,
        turnId: SOURCE_TURNS[3]?.id ?? "",
        quote: TURN_B2,
        isVerified: true,
      }),
      claimOf({
        side: "b",
        position: 2,
        turnId: SOURCE_TURNS[2]?.id ?? "",
        quote: "A quote the note does not hold at all.",
        isVerified: false,
      }),
    ],
  },
];

// The approved items of both cards, the verified ones first in position order.
const ITEMS: ApprovedItem[] = [
  {
    side: "a",
    position: 1,
    kind: "habit",
    claim: "Writes the plan first",
    lang: "en",
    quote: TURN_A1,
    turnId: SOURCE_TURNS[0]?.id ?? "",
    verified: true,
  },
  {
    side: "b",
    position: 1,
    kind: "value",
    claim: "Keeps deadlines",
    lang: "en",
    quote: TURN_B1,
    turnId: SOURCE_TURNS[2]?.id ?? "",
    verified: true,
  },
];

// The brief prompt and the untrusted-data rules, read as the job reads them.
const PROMPT_TEXT = readPrompt("brief").text;
const RULES_TEXT = readPrompt("untrusted-data-rules").text;

// The prompt input for side a, from the fixtures above.
function inputForA(): Parameters<typeof buildBriefPromptInput>[0] {
  return {
    recipient: SIDE_A,
    other: SIDE_B,
    questionText: QUESTION,
    questionKind: "situation",
    sourceTurns: SOURCE_TURNS,
    transcript: TRANSCRIPT,
    items: ITEMS,
    promptText: PROMPT_TEXT,
    untrustedRulesText: RULES_TEXT,
  };
}

describe("brief prompt input", () => {
  it("W2-BRIEF-T5 (R7.3): the prompt input wraps transcript and cards in their tags and shows flagged claims as no receipt", () => {
    const input = buildBriefPromptInput(inputForA());
    const system = input.messages[0]?.content ?? "";
    const user = input.messages[1]?.content ?? "";
    expect(user).toMatch(/<transcript>[\s\S]*<\/transcript>/);
    expect(user).toMatch(/<card side="a">[\s\S]*<\/card>/);
    expect(user).toContain("[claim 3-2 | no receipt]");
    expect(user).toContain("[claim 1-1 | verified]");
    expect(system).toContain(RULES_TEXT);
    expect(system).not.toContain("{{untrusted_data_rules}}");
    expect(system).toContain("You write for the human on side a.");
    expect(
      user.startsWith('<question kind="situation">How do you handle a missed deadline?</question>'),
    ).toBe(true);
  });

  it("W2-BRIEF-T7 (D20 replay): buildBriefPromptInput is deterministic across two calls", () => {
    const first = buildBriefPromptInput(inputForA());
    const second = buildBriefPromptInput(inputForA());
    expect(JSON.stringify(first.messages)).toBe(JSON.stringify(second.messages));
    expect(first.citable.map((quote) => quote.origin)).toEqual(
      second.citable.map((quote) => quote.origin),
    );
  });

  it("W2-BRIEF-T6 (D25, D26): verifyBriefQuotes marks a quote verified only inside its named turn and its own side", () => {
    const quote = (text: string, side: "a" | "b", turnId: string) => ({
      text,
      side,
      turn_id: turnId,
    });
    const exact = quote(TURN_A1, "a", "t:1");
    const curly = quote("I don't move a deadline without telling the team first.", "b", "t:1");
    const spanning = quote(
      "I write the plan down before a big meeting so nobody guesses. Deadlines matter to me",
      "a",
      "t:1",
    );
    const otherSideTurn = quote(TURN_A1, "b", "t:1");
    const output: BriefOutput = {
      agree: [
        { text: "Agree one", quotes: [exact] },
        { text: "Agree two", quotes: [curly] },
        { text: "Agree three", quotes: [spanning, otherSideTurn] },
      ],
      clash: [
        { text: "Clash one", quotes: [exact] },
        { text: "Clash two", quotes: [exact] },
        { text: "Clash three", quotes: [exact] },
      ],
      decide_first: [
        { text: "Decide one", quotes: [exact] },
        { text: "Decide two", quotes: [exact] },
        { text: "Decide three", quotes: [exact] },
      ],
    };
    const sections = verifyBriefQuotes({
      output,
      sourceTurns: SOURCE_TURNS,
      personBySide: { a: SIDE_A.personId, b: SIDE_B.personId },
      questionText: QUESTION,
    });
    const quotes = sections.agree.flatMap((point) => point.quotes);
    expect(quotes.map((checked) => checked.verified)).toEqual([true, true, false, false]);
    expect(quotes.map((checked) => checked.text)).toEqual([
      exact.text,
      curly.text,
      spanning.text,
      otherSideTurn.text,
    ]);
    expect(quotes[0]?.turnId).toBe(SOURCE_TURNS[0]?.id);
  });
});
