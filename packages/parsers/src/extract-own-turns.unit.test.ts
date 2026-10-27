import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import { detectKind, extractOwnTurns } from "./extract-own-turns.js";

// Reads one fixture file from packages/parsers/fixtures as text.
async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

// Runs a function and returns what it threw, or undefined when it did not throw.
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("extractOwnTurns", () => {
  it("R1.1-T1: reads 7 own turns from the ChatGPT 2024 mapping fixture", async () => {
    const text = await fixture("chatgpt-2024-mapping.json");
    const result = extractOwnTurns([{ name: "conversations.json", text }], null);
    expect(result.kind).toBe("chatgpt");
    expect(result.turns.length).toBe(7);
    expect(result.foundTurns).toBe(7);
    expect(itemAt(result.turns, 0).text).toBe("I keep rewriting my CV because I never feel it says who I am.");
    expect(itemAt(result.turns, 1).text).toBe("Here is the summary I wrote last night.\n[image]");
    expect(itemAt(result.turns, 3).text).toBe("Actually, cut the hobbies section, I never know what to put there.");
    expect(result.personaSignal).toBe(1);
    expect(result.canonicalChars).toBe(448);
  });

  it("R1.1-T2: reads 4 own turns from the ChatGPT 2026 messages fixture", async () => {
    const text = await fixture("chatgpt-2026-messages.json");
    const result = extractOwnTurns([{ name: "conversations.json", text }], null);
    expect(result.kind).toBe("chatgpt");
    expect(result.turns.length).toBe(4);
    expect(itemAt(result.turns, 0).text).toBe("Can you help me plan a week where I actually rest?");
    expect(result.personaSignal).toBe(0.75);
    expect(result.canonicalChars).toBe(221);
  });

  it("R1.1-T3: reads 5 own turns from the Claude fixture, one from content only", async () => {
    const text = await fixture("claude-chat-messages.json");
    const result = extractOwnTurns([{ name: "conversations.json", text }], null);
    expect(result.kind).toBe("claude");
    expect(result.turns.length).toBe(5);
    expect(itemAt(result.turns, 0).text).toBe("I said yes to a project I should have refused.");
    expect(itemAt(result.turns, 2).text).toBe("Next time I will ask for a week to think before I answer.");
    expect(result.personaSignal).toBe(1);
    expect(result.canonicalChars).toBe(258);
  });

  it("R1.1-T4: reads 9 blank-line blocks from the notes fixture", async () => {
    const text = await fixture("notes.md");
    const result = extractOwnTurns([{ name: "notes.md", text }], null);
    expect(result.kind).toBe("notes");
    expect(result.turns.length).toBe(9);
    expect(itemAt(result.turns, 0).text).toBe("Things I know about myself:");
    expect(result.canonicalChars).toBe(1460);
    expect(result.personaSignal).toBe(1);
  });

  it("R1.1-T5: reads 8 blocks from the paste fixture", async () => {
    const text = await fixture("paste.txt");
    const result = extractOwnTurns([{ name: "paste.txt", text }], null);
    expect(result.kind).toBe("paste");
    expect(result.turns.length).toBe(8);
    expect(itemAt(result.turns, 0).text).toBe("I work best before nine in the morning.");
    expect(result.canonicalChars).toBe(1637);
  });

  it("R1.1-T6: keeps no assistant text from the 2024 fixture", async () => {
    const text = await fixture("chatgpt-2024-mapping.json");
    const joined = extractOwnTurns([{ name: "conversations.json", text }], null).turns.map((turn) => turn.text).join("\n");
    expect(joined).not.toContain("Shall I shorten it?");
    expect(joined).not.toContain("What do you want a reader to notice first?");
    expect(joined).not.toContain("I am a teacher in Pune.");
  });

  it("R1.1-T7: detectKind picks the path from the hint, the name and the first character", () => {
    expect(detectKind({ name: "conversations.json", text: "[{}]" }, null)).toBe("chatgpt");
    expect(detectKind({ name: "data.JSON", text: "﻿  {}" }, null)).toBe("chatgpt");
    expect(detectKind({ name: "notes.md", text: "x" }, null)).toBe("notes");
    expect(detectKind({ name: "export.txt", text: "[x" }, null)).toBe("paste");
    expect(detectKind({ name: "weird.json", text: "hello" }, null)).toBe("paste");
    expect(detectKind({ name: "conversations.json", text: "[]" }, "paste")).toBe("paste");
  });

  it("R1.1-T8: a .json file that starts like JSON but does not parse throws source_file_not_json", () => {
    const error = thrownBy(() => extractOwnTurns([{ name: "broken.json", text: "{not json" }], null));
    expect(error).toBeInstanceOf(ContractError);
    expect(error).toMatchObject({ code: "source_file_not_json", httpStatus: 422 });
  });

  it("R1.1-T9: files are joined in order and the kind comes from the first that added turns", () => {
    const result = extractOwnTurns(
      [
        { name: "a.json", text: "[{\"messages\":[{\"role\":\"assistant\",\"content\":\"x\"}]}]" },
        { name: "b.md", text: "First note here.\n\nSecond note." },
      ],
      null,
    );
    expect(result.kind).toBe("notes");
    expect(result.turns.map((turn) => turn.text)).toEqual(["First note here.", "Second note."]);
    expect(itemAt(result.turns, 0).turnIndex).toBe(0);
    expect(itemAt(result.turns, 1).turnIndex).toBe(1);
  });

  it("D10-T1: paste blocks split on blank lines, including a line of spaces", () => {
    const result = extractOwnTurns([{ name: "paste.txt", text: "one block here\n  \nsecond block\n\n\n\nthird" }], "paste");
    expect(result.turns.map((turn) => turn.text)).toEqual(["one block here", "second block", "third"]);
  });

  it("D9-T1: an export with only assistant messages throws source_no_own_turns", () => {
    const text = "[{\"messages\":[{\"role\":\"assistant\",\"content\":\"Hello there.\"}]}]";
    const error = thrownBy(() => extractOwnTurns([{ name: "conversations.json", text }], null));
    expect(error).toBeInstanceOf(ContractError);
    expect(error).toMatchObject({
      code: "source_no_own_turns",
      httpStatus: 422,
      message: "No messages written by you were found in this file. Pick the export file itself (conversations.json inside the zip), or paste some notes instead.",
    });
  });

  it("D9-T2: a paste of whitespace only throws source_no_own_turns", () => {
    const error = thrownBy(() => extractOwnTurns([{ name: "paste.txt", text: "   \n\n  \n" }], "paste"));
    expect(error).toMatchObject({ code: "source_no_own_turns" });
  });

  it("R1.1-T25: reads 6 own turns from the Codex session fixture, stored as kind chatgpt, with the repeat dropped", async () => {
    const text = await fixture("codex-session.jsonl");
    const result = extractOwnTurns([{ name: "sessions/2026/10/02/rollout-2026-10-02T08-00-00.jsonl", text }], null);
    expect(result.kind).toBe("chatgpt");
    expect(result.turns.map((turn) => turn.text)).toEqual([
      "I want the watering reminders to feel gentle, because I forget my plants when I am stressed.",
      "Can you match the colours on this page? I like how calm it looks.",
      "This is my balcony, and I only get morning sun.",
      "I wrote this plan at midnight, so please be kind to it.",
      "I drew the layout on paper first, because that is how I think.",
      "yes, go ahead",
    ]);
    expect(result.foundTurns).toBe(6);
    expect(result.personaSignal).toBe(1);
    expect(result.canonicalChars).toBe(334);
  });

  it("R1.1-T33: a message repeated in a later Codex session is kept once, in its first place", async () => {
    const first = await fixture("codex-session.jsonl");
    const session = JSON.stringify({ type: "session_meta", payload: { source: "vscode", thread_source: "user" } });
    const repeat = JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "yes, go ahead" }] } });
    const fresh = JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "I name every plant after a city." }] } });
    const result = extractOwnTurns(
      [
        { name: "a/rollout-1.jsonl", text: first },
        { name: "b/rollout-2.JSONL", text: [session, repeat, fresh].join("\n") },
      ],
      null,
    );
    expect(result.turns.map((turn) => turn.text).slice(4)).toEqual(["I drew the layout on paper first, because that is how I think.", "yes, go ahead", "I name every plant after a city."]);
    expect(result.turns.map((turn) => turn.turnIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(result.foundTurns).toBe(7);
  });

  it("R1.1-T34: detectKind sends a .jsonl file that starts like JSON to the Codex reader, which stores it as chatgpt", () => {
    expect(detectKind({ name: "rollout-2026-10-02.jsonl", text: "{\"type\":\"session_meta\"}" }, null)).toBe("chatgpt");
    expect(detectKind({ name: "ROLLOUT.JSONL", text: "\n{}" }, null)).toBe("chatgpt");
    expect(detectKind({ name: "notes.jsonl", text: "hello" }, null)).toBe("paste");
  });

  it("R1.1-T35: a .jsonl file that holds only a helper's session throws source_no_own_turns", () => {
    const session = JSON.stringify({ type: "session_meta", payload: { source: { subagent: { other: "guardian" } }, thread_source: "guardian_review" } });
    const prompt = JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Check this command." }] } });
    const error = thrownBy(() => extractOwnTurns([{ name: "rollout.jsonl", text: `${session}\n${prompt}` }], null));
    expect(error).toMatchObject({ code: "source_no_own_turns" });
  });

  it("INV1-T1: every turn is role user with no sensitive categories and indices from 0", async () => {
    const text = await fixture("chatgpt-2024-mapping.json");
    const result = extractOwnTurns([{ name: "conversations.json", text }], null);
    for (const turn of result.turns) {
      expect(turn.role).toBe("user");
      expect(turn.sensitiveCategories).toEqual([]);
      expect(turn.lang).toBe("en");
    }
    expect(result.turns.map((turn) => turn.turnIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
