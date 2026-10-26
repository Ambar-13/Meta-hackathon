import { describe, expect, it } from "vitest";
import type { Turn } from "@meet-first/contracts";
import { extractOwnTurns } from "@meet-first/parsers";
import notesText from "../../../../packages/parsers/fixtures/notes.md?raw";
import { cutScrubbedText, scrubForUpload } from "./scrub-preview.js";

// Builds the turns a source holds from plain texts, numbered in order.
function turnsOf(texts: string[]): Turn[] {
  return texts.map((text, index) => ({ turnIndex: index, role: "user", text, lang: "en", sensitiveCategories: [] }));
}

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

describe("scrubForUpload", () => {
  it("A3-T1: the notes fixture previews 1 redaction, the email, and leaves the name to the names pass", () => {
    const turns = extractOwnTurns([{ name: "notes.md", text: notesText }], null).turns;
    const preview = scrubForUpload(turns, ["Asha Rao"]);
    expect(preview.previewRedactionCount).toBe(1);
    expect(itemAt(preview.turns, 3).text).toBe(
      "My closest friend is Priya Nair, and she tells me the truth.\nWhen we argue, she wins because she listens longer.\nI still email her at [redacted:email:00000001] every Sunday.",
    );
    expect(preview.turns.length).toBe(9);
  });

  it("D11-T3: one counter runs across the turns of a source", () => {
    const preview = scrubForUpload(turnsOf(["a@example.com", "b@example.com"]), []);
    expect(preview.turns.map((turn) => turn.text)).toEqual(["[redacted:email:00000001]", "[redacted:email:00000002]"]);
    expect(preview.previewRedactionCount).toBe(2);
  });

  it("D5-T7: a scrubbed turn over 20,000 characters is cut before the placeholder it would split", () => {
    const preview = scrubForUpload(turnsOf(["a".repeat(19_990) + " 98765432"]), []);
    expect(itemAt(preview.turns, 0).text).toBe("a".repeat(19_990) + " ");
    expect(itemAt(preview.turns, 0).text.length).toBe(19_991);
    expect(preview.previewRedactionCount).toBe(0);
  });

  it("D5-T8: placeholders that push the total past 2 MiB drop turns from the end", () => {
    const text = "a".repeat(18_550) + " 98765432".repeat(50);
    const preview = scrubForUpload(turnsOf(Array.from({ length: 110 }, () => text)), []);
    expect(preview.turns.length).toBe(105);
    expect(itemAt(preview.turns, 104).turnIndex).toBe(104);
    expect(preview.turns.every((turn) => turn.text.length === 19_850)).toBe(true);
    expect(preview.previewRedactionCount).toBe(5_250);
  });

  it("D5-T9: cutScrubbedText cuts at the last line break when there is one", () => {
    expect(cutScrubbedText(("p".repeat(99) + "\n").repeat(210)).length).toBe(19_999);
  });
});
