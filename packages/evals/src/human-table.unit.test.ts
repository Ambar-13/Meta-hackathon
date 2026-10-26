// Unit tests for the human metrics table: it aggregates the sides of each response and skips the example.
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHumanTable } from "./human-table.js";

let folder = "";
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eval-human-"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// One side's answers, written as the form asks them.
function side(answers: { card: number; unsupported: string[]; worth: number; useIt: boolean }) {
  return { cardRepresentedYou: answers.card, unsupportedLines: answers.unsupported, surfacedWorthDiscussing: answers.worth, wouldUseBeforeChoosingTeammate: { answer: answers.useIt, why: "Because it helps." } };
}

// One response file with a pair id, the known-collaborator flag, both sides and any friction points.
function response(input: { pairId: string; knownCollaborators: boolean; sides: { a: ReturnType<typeof side>; b: ReturnType<typeof side> }; friction: Array<{ text: string; knownBeforeReveal: boolean }> }) {
  return {
    pairId: input.pairId,
    askedAt: "2026-10-28T12:00:00.000Z",
    outcomeDefinition: "Both of us can name one shared next step after reading the brief.",
    knownCollaborators: input.knownCollaborators,
    sides: input.sides,
    frictionPoints: input.friction,
  };
}

describe("human table", () => {
  it("W2-EVAL-T11 (A6): the human table aggregates sides, counts yes and no, and counts friction points known before the reveal", async () => {
    writeFileSync(join(folder, "p1.json"), JSON.stringify(response({
      pairId: "p1",
      knownCollaborators: true,
      sides: { a: side({ card: 4, unsupported: ["A line"], worth: 4, useIt: true }), b: side({ card: 5, unsupported: [], worth: 3, useIt: false }) },
      friction: [
        { text: "Money split", knownBeforeReveal: true },
        { text: "Hours", knownBeforeReveal: false },
      ],
    })));
    writeFileSync(join(folder, "p2.json"), JSON.stringify(response({ pairId: "p2", knownCollaborators: false, sides: { a: side({ card: 3, unsupported: [], worth: 5, useIt: true }), b: side({ card: 4, unsupported: [], worth: 4, useIt: true }) }, friction: [] })));
    copyFileSync(join(import.meta.dirname, "..", "fixtures", "human", "responses", "example-pair.json"), join(folder, "example-pair.json"));
    const named = response({ pairId: "p3", knownCollaborators: false, sides: { a: side({ card: 2, unsupported: [], worth: 2, useIt: false }), b: side({ card: 2, unsupported: [], worth: 2, useIt: false }) }, friction: [] });
    writeFileSync(join(folder, "named.json"), JSON.stringify({ ...named, name: "Not allowed" }));

    const { table, count } = await buildHumanTable(folder);
    expect(count).toBe(2);
    expect(table).toContain("| Did the card represent you? (1 to 5) | 4.0 | 4 people |");
    expect(table).toContain("| Did any brief line feel unsupported? | 1 of 4 said yes | 4 people |");
    expect(table).toContain("| Did the brief surface something worth discussing? (1 to 5) | 4.0 | 4 people |");
    expect(table).toContain("| Would you use it before choosing a teammate? | 3 yes, 1 no | 4 people |");
    expect(table).toContain("| Friction points known before the reveal | 1 of 2 | 1 known-collaborator pairs |");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("named.json"));
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("example-pair.json"));
  });

  it("W2-EVAL-T12 (A6): zero responses prints No real pairs yet.", async () => {
    const empty = mkdtempSync(join(tmpdir(), "eval-human-empty-"));
    copyFileSync(join(import.meta.dirname, "..", "fixtures", "human", "responses", "example-pair.json"), join(empty, "example-pair.json"));
    const result = await buildHumanTable(empty);
    expect(result).toEqual({ table: "No real pairs yet.", count: 0 });
  });
});
