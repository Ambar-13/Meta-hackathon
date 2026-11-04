import { describe, expect, it } from "vitest";
import { QUIZ_BANK, quizCopy } from "@meet-first/contracts";
import {
  CALIBRATION_BANK,
  calibrationEntryFor,
  checkCalibrationRun,
  missTexts,
} from "./calibration.js";
import { requireElement } from "./quiz-requests.js";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

// Five answered items: three disagree (ids 4, 8 and 9), one agrees, one is unanswered.
const MISS_ITEMS = [
  { questionId: 9, questionText: "nine", agree: false },
  { questionId: 4, questionText: "four", agree: false },
  { questionId: 1, questionText: "one", agree: true },
  { questionId: 8, questionText: "eight", agree: false },
  { questionId: 2, questionText: "two", agree: null },
];

describe("quiz copy, calibration and misses", () => {
  it("D31-T1: the copy reads matched n of 10 for every n", () => {
    for (let count = 0; count <= 10; count += 1) {
      expect(quizCopy(count, true)).toBe(`matched ${String(count)} of 10`);
    }
  });

  it("D31-T2: an unreliable count adds the second sentence", () => {
    expect(quizCopy(7, false)).toBe("matched 7 of 10. This count may be a little off.");
  });

  it("R4.5-T1: no copy is ever a percentage", () => {
    for (let count = 0; count <= 10; count += 1) {
      for (const isReliable of [true, false]) {
        expect(quizCopy(count, isReliable)).not.toMatch(/%|percent/i);
      }
    }
  });

  it("D30-T3: a run passes when the identical pair agrees and the contradicting pair does not", () => {
    const result = checkCalibrationRun({
      run: 1,
      entryIndex: 0,
      results: [
        { output: { agree: true, reason: "r" }, ledgerId: U1 },
        { output: { agree: false, reason: "r" }, ledgerId: U2 },
      ],
    });

    expect(result.isPassed).toBe(true);
    expect(requireElement(result.pairs, 0)).toMatchObject({
      pair: "identical",
      shouldAgree: true,
      isPassed: true,
      ledgerId: U1,
    });
    expect(requireElement(result.pairs, 1)).toMatchObject({
      pair: "contradicting",
      shouldAgree: false,
      isPassed: true,
      ledgerId: U2,
    });
  });

  it("D30-T4: an identical pair judged as disagreeing fails the run", () => {
    const result = checkCalibrationRun({
      run: 1,
      entryIndex: 0,
      results: [
        { output: { agree: false, reason: "r" }, ledgerId: U1 },
        { output: { agree: false, reason: "r" }, ledgerId: U2 },
      ],
    });

    expect(result.isPassed).toBe(false);
    expect(requireElement(result.pairs, 0).isPassed).toBe(false);
    expect(requireElement(result.pairs, 1).isPassed).toBe(true);
  });

  it("D30-T5: a lenient judge that agrees with the contradicting pair fails the run", () => {
    const result = checkCalibrationRun({
      run: 1,
      entryIndex: 0,
      results: [
        { output: { agree: true, reason: "r" }, ledgerId: U1 },
        { output: { agree: true, reason: "r" }, ledgerId: U2 },
      ],
    });

    expect(result.isPassed).toBe(false);
    expect(requireElement(result.pairs, 1).isPassed).toBe(false);
  });

  it("D30-T6: an unreadable calibration reply fails its pair", () => {
    const result = checkCalibrationRun({
      run: 1,
      entryIndex: 0,
      results: [
        { output: null, ledgerId: U1 },
        { output: { agree: false, reason: "r" }, ledgerId: U2 },
      ],
    });

    expect(result.isPassed).toBe(false);
    expect(requireElement(result.pairs, 0).output).toBeNull();
    expect(requireElement(result.pairs, 0).isPassed).toBe(false);
  });

  it("R4.6-T1: the calibration bank holds eight probes, none of them a bank question", () => {
    expect(CALIBRATION_BANK).toHaveLength(8);
    expect(CALIBRATION_BANK.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const entry of CALIBRATION_BANK) {
      expect(entry.answerA).not.toBe(entry.answerB);
    }
    const probeTexts = CALIBRATION_BANK.map((entry) => entry.questionText);
    expect(new Set(probeTexts).size).toBe(8);
    const bankTexts = QUIZ_BANK.map((question) => question.text);
    for (const text of probeTexts) {
      expect(bankTexts).not.toContain(text);
    }
  });

  it("D30-T7: the quiz id picks the probe and run 2 takes the next one", () => {
    expect(calibrationEntryFor("0a000000-0000-4000-8000-000000000104", 1).index).toBe(2);
    expect(calibrationEntryFor("0a000000-0000-4000-8000-000000000104", 2).index).toBe(3);
    expect(calibrationEntryFor("ff000000-0000-4000-8000-000000000001", 1).index).toBe(7);
    expect(calibrationEntryFor("ff000000-0000-4000-8000-000000000001", 2).index).toBe(0);
  });

  it("D31-T3: the misses are the disagreeing items in question id order", () => {
    expect(missTexts({ state: "judged", reliable: true }, MISS_ITEMS)).toEqual([
      "four",
      "eight",
      "nine",
    ]);
  });

  it("D31-T4: there are no misses without a reliable judged quiz", () => {
    expect(missTexts(undefined, MISS_ITEMS)).toEqual([]);
    expect(missTexts({ state: "judging", reliable: null }, MISS_ITEMS)).toEqual([]);
    expect(missTexts({ state: "judged", reliable: false }, MISS_ITEMS)).toEqual([]);
  });
});
