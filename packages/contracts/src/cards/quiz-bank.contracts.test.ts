import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QUIZ_BANK, sampleQuiz } from "./quiz-bank.js";

const MIGRATION_FILE = fileURLToPath(
  new URL("../../../db/migrations/0001_foundation.sql", import.meta.url),
);
const SEED_ROW = /\(1, (\d+), '((?:[^']|'')*)'\)/g;

describe("quiz bank", () => {
  it("D28-T1: the quiz bank has 30 questions with ids 1 to 30", () => {
    const ids = QUIZ_BANK.map((question) => question.id);

    expect(QUIZ_BANK).toHaveLength(30);
    expect(ids).toEqual(Array.from({ length: 30 }, (value, index) => index + 1));
  });

  it("D28-T2: sampleQuiz returns the same 10 ids for the same card id across calls", () => {
    const cardId = "0f2b9d0c-4f0e-4f7e-9a63-5e8b2b1a9c11";

    const first = sampleQuiz(cardId);
    const second = sampleQuiz(cardId);

    expect(second).toEqual(first);
    expect(first).toHaveLength(10);
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    expect(new Set(first).size).toBe(10);
    expect(first.every((id) => id >= 1 && id <= 30)).toBe(true);
  });

  it("D28-T3: two different card ids give different samples", () => {
    const firstCard = sampleQuiz("0f2b9d0c-4f0e-4f7e-9a63-5e8b2b1a9c11");
    const secondCard = sampleQuiz("7c9e6679-7425-40de-944b-e07fc1f90ae7");

    expect(firstCard).not.toEqual(secondCard);
  });

  it("R4.7-T1: the migration seed equals QUIZ_BANK", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf8");
    const seeded = [...sql.matchAll(SEED_ROW)].map((match) => ({
      id: Number(match[1]),
      text: (match[2] ?? "").replace(/''/g, "'"),
    }));

    expect(seeded).toHaveLength(30);
    const mismatches = seeded.filter((row) => QUIZ_BANK[row.id - 1]?.text !== row.text);
    expect(mismatches.map((row) => row.id)).toEqual([]);
  });
});
