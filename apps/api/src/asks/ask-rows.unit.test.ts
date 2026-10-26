import { describe, expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import { isMeetableAnswer, parseStoredClaims, sortAnswersForView, toAboutMeAnswer, toAskAnswer, type AnswerRow } from "./ask-rows.js";
import { isLongEnoughAskText } from "./create-ask.js";

// The error parseStoredClaims throws for a value, or null when it throws none.
function errorOf(value: unknown): unknown {
  try {
    parseStoredClaims(value);
    return null;
  } catch (error) {
    return error;
  }
}

describe("ask rows", () => {
  it("W6-ASKA-T1 (design section 6): sortAnswersForView puts placed answers first by position, then the rest by shortlist rank, then by id", () => {
    const rows = [{ id: "row-c", position: null, shortlist_rank: 2 }, { id: "row-b", position: 2, shortlist_rank: 5 }, { id: "row-a", position: 1, shortlist_rank: 4 }, { id: "row-e", position: null, shortlist_rank: 3 }, { id: "row-d", position: null, shortlist_rank: 3 }];

    const sorted = sortAnswersForView(rows);

    expect(sorted.map((row) => row.id)).toEqual(["row-a", "row-b", "row-c", "row-d", "row-e"]);
    expect(rows[0]?.id).toBe("row-c");
  });

  it("W6-ASKA-T2 (design section 6): isMeetableAnswer is true only for a done help ask with an answered row placed 1 to 3 that still has its listing", () => {
    expect(isMeetableAnswer({ mode: "help", state: "done" }, { state: "answered", position: 1, listing_id: "listing-1" })).toBe(true);
    expect(isMeetableAnswer({ mode: "help", state: "done" }, { state: "answered", position: 3, listing_id: "listing-1" })).toBe(true);
    expect(isMeetableAnswer({ mode: "help", state: "done" }, { state: "answered", position: 4, listing_id: "listing-1" })).toBe(false);
    expect(isMeetableAnswer({ mode: "help", state: "done" }, { state: "answered", position: null, listing_id: "listing-1" })).toBe(false);
    expect(isMeetableAnswer({ mode: "help", state: "done" }, { state: "answered", position: 1, listing_id: null })).toBe(false);
    expect(isMeetableAnswer({ mode: "help", state: "ranking" }, { state: "answered", position: 1, listing_id: "listing-1" })).toBe(false);
    expect(isMeetableAnswer({ mode: "react", state: "done" }, { state: "answered", position: 1, listing_id: "listing-1" })).toBe(false);
    expect(isMeetableAnswer({ mode: "help", state: "done" }, { state: "pending", position: 1, listing_id: "listing-1" })).toBe(false);
  });

  it("W6-ASKA-T3 (P6, design section 10): the views keep only their contract fields, drop the stored turnId, and a broken claims value throws answer_row_invalid with status 500", () => {
    const claims = [{ text: "Reads the logs first", quote: "I always read the logs first.", turnId: "00000000-0000-4000-8000-000000000301", verified: true, supported: null }];
    const row: AnswerRow = { id: "answer-1", state: "answered", subject_display_name: "Mira", subject_line: "I fix flaky deploys.", answer: "Mira's persona would probably read the logs first.", has_sign: true, claims, position: 1, listing_id: "listing-1", shortlist_rank: 2 };

    const answer = toAskAnswer({ mode: "help", state: "done" }, row);
    const about = toAboutMeAnswer({ id: "answer-1", mode: "help", ask_text: "Our deploys fail at night.", asker_display_name: "Ola", answer: "Mira's persona would probably read the logs first.", claims, created_at: new Date("2026-10-27T10:00:00.000Z") });

    expect(answer).toEqual({ answerId: "answer-1", displayName: "Mira", line: "I fix flaky deploys.", answer: "Mira's persona would probably read the logs first.", claims: [{ text: "Reads the logs first", quote: "I always read the logs first.", verified: true, supported: null }], hasSign: true, position: 1, canMeet: true });
    expect(Object.keys(answer.claims[0] ?? {}).sort()).toEqual(["quote", "supported", "text", "verified"]);
    expect(about).toEqual({ answerId: "answer-1", mode: "help", text: "Our deploys fail at night.", askerName: "Ola", answer: "Mira's persona would probably read the logs first.", claims: [{ text: "Reads the logs first", quote: "I always read the logs first.", verified: true, supported: null }], createdAt: "2026-10-27T10:00:00.000Z" });
    for (const value of [[{ text: "only a text" }], "not a list"]) {
      const error = errorOf(value);
      expect(error).toBeInstanceOf(ContractError);
      expect(error).toMatchObject({ code: "answer_row_invalid", httpStatus: 500, message: "One answer of this ask could not be read. Try again in a minute." });
    }
  });

  it("W6-ASKA-T4 (design section 6): isLongEnoughAskText counts characters, not UTF-16 units", () => {
    expect("a😀😀".length).toBe(5);
    expect(isLongEnoughAskText("abcde")).toBe(true);
    expect(isLongEnoughAskText("abcd")).toBe(false);
    expect(isLongEnoughAskText("a😀😀")).toBe(false);
    expect(isLongEnoughAskText("ab😀cd")).toBe(true);
    expect(isLongEnoughAskText("😀😀😀😀😀")).toBe(true);
  });
});
