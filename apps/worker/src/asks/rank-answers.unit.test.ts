import { expect, it } from "vitest";
import type { StoredAnswerClaim } from "./ask-requests.js";
import type { AnswerRow } from "./ask-store.js";
import {
  applyVerdicts,
  judgeChunks,
  placeAnswers,
  readJudgeVerdicts,
  supportedCount,
} from "./rank-answers.js";

const TURN = "11111111-1111-4111-8111-111111111100";
const SUBJECT = "33333333-3333-4333-8333-333333333300";
const CARD = "44444444-4444-4444-8444-444444444400";

// One stored claim; a verified one names TURN.
function claimOf(label: string, isVerified: boolean): StoredAnswerClaim {
  return {
    text: "claim " + label,
    quote: "quote " + label,
    turnId: isVerified ? TURN : null,
    verified: isVerified,
    supported: null,
  };
}

// One answered row with these claims.
function rowOf(id: string, rank: number, claims: StoredAnswerClaim[]): AnswerRow {
  return {
    id,
    subjectPersonId: SUBJECT,
    subjectCardId: CARD,
    listingId: null,
    askerDisplayName: "Ana",
    subjectDisplayName: "Kai",
    shortlistRank: rank,
    state: "answered",
    hasSign: true,
    claims,
  };
}

it("W6-ASKW-T11 (design section 4 step 5): verified claims are chunked by shortlist rank and claim order, 30 to a chunk", () => {
  const small = judgeChunks([
    rowOf("A", 2, [claimOf("a0", true), claimOf("a1", true), claimOf("a2", false)]),
    rowOf("B", 1, [claimOf("b0", true)]),
  ]);
  const big = judgeChunks(
    Array.from(Array(11).keys(), (index) =>
      rowOf("answer-" + String(11 - index), 11 - index, [
        claimOf("x", true),
        claimOf("y", true),
        claimOf("z", true),
      ]),
    ),
  );

  expect(small).toEqual([
    [
      {
        answerId: "B",
        claimIndex: 0,
        claim: { text: "claim b0", quote: "quote b0", turnId: TURN },
        supported: null,
      },
      {
        answerId: "A",
        claimIndex: 0,
        claim: { text: "claim a0", quote: "quote a0", turnId: TURN },
        supported: null,
      },
      {
        answerId: "A",
        claimIndex: 1,
        claim: { text: "claim a1", quote: "quote a1", turnId: TURN },
        supported: null,
      },
    ],
  ]);
  expect(big.map((chunk) => chunk.length)).toEqual([30, 3]);
  expect([
    big[0]?.[0]?.answerId,
    big[0]?.[0]?.claimIndex,
    big[0]?.[29]?.answerId,
    big[0]?.[29]?.claimIndex,
  ]).toEqual(["answer-1", 0, "answer-10", 2]);
  expect(big[1]?.map((ref) => [ref.answerId, ref.claimIndex])).toEqual([
    ["answer-11", 0],
    ["answer-11", 1],
    ["answer-11", 2],
  ]);
});

it("W6-ASKW-T12 (A1): a reply counts only with one line for each index from 0 to count - 1", () => {
  const line = (index: number, supported: boolean) => ({ index, supported, reason: "r" });

  expect(readJudgeVerdicts({ lines: [line(2, true), line(0, false), line(1, true)] }, 3)).toEqual([
    false,
    true,
    true,
  ]);
  expect(readJudgeVerdicts({ lines: [line(0, true), line(1, true)] }, 3)).toBeNull();
  expect(
    readJudgeVerdicts({ lines: [line(0, true), line(0, false), line(1, true)] }, 3),
  ).toBeNull();
  expect(readJudgeVerdicts({ lines: [line(0, true), line(1, true), line(3, true)] }, 3)).toBeNull();
  expect(readJudgeVerdicts({ lines: [{ index: 0, supported: true, reason: "" }] }, 1)).toBeNull();
  expect(readJudgeVerdicts("not a reply", 1)).toBeNull();
});

it("W6-ASKW-T13 (A1): a chunk's verdicts land on the right claims of the right answers, and the rows given stay unchanged", () => {
  const answers = [
    rowOf("A", 1, [claimOf("a0", true), claimOf("a1", false), claimOf("a2", true)]),
    rowOf("B", 2, [claimOf("b0", true)]),
    rowOf("C", 3, [claimOf("c0", true)]),
  ];
  const chunk = (judgeChunks(answers)[0] ?? []).slice(0, 3);

  const touched = applyVerdicts(answers, chunk, [true, false, true]);

  expect([...touched.keys()]).toEqual(["A", "B"]);
  expect(touched.get("A")?.map((claim) => claim.supported)).toEqual([true, null, false]);
  expect(touched.get("B")?.map((claim) => claim.supported)).toEqual([true]);
  expect(answers[0]?.claims.map((claim) => claim.supported)).toEqual([null, null, null]);
});

it("W6-ASKW-T14 (design section 4 step 5): the supported count takes the verified claims the check did not turn down", () => {
  const claims: StoredAnswerClaim[] = [
    { ...claimOf("a", true), supported: true },
    { ...claimOf("b", true), supported: false },
    { ...claimOf("c", true), supported: null },
    { ...claimOf("d", false), supported: null },
  ];

  expect(supportedCount(claims)).toBe(2);
  expect(supportedCount([claimOf("e", true), claimOf("f", true), claimOf("g", true)])).toBe(3);
  expect(supportedCount([])).toBe(0);
});

it("W6-ASKW-T15 (design section 4 step 6): places go to answers with a sign and a supported claim, most supported first, then by shortlist rank", () => {
  const places = placeAnswers([
    { id: "a", shortlistRank: 1, hasSign: true, supportedCount: 1 },
    { id: "b", shortlistRank: 2, hasSign: true, supportedCount: 2 },
    { id: "c", shortlistRank: 3, hasSign: true, supportedCount: 2 },
    { id: "d", shortlistRank: 4, hasSign: false, supportedCount: 3 },
    { id: "e", shortlistRank: 5, hasSign: true, supportedCount: 0 },
  ]);

  expect(Object.fromEntries(places)).toEqual({ a: 3, b: 1, c: 2, d: null, e: null });
});
