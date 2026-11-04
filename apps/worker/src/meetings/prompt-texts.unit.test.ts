import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { SEED_TURNS_A, SEED_TURNS_B } from "@meet-first/db/testing";
import { readPrompt } from "@meet-first/prompts";
import { normQuote, QUOTE_MIN_CHARS } from "@meet-first/receipts";

// The people fixtures the golden path and the eval upload.
const PEOPLE_DIR = fileURLToPath(
  new URL("../../../../packages/evals/fixtures/people", import.meta.url),
);

// The user messages of one ChatGPT export fixture.
function exportLines(text: string): string[] {
  const conversations = JSON.parse(text) as Array<{
    mapping: Record<
      string,
      { message: { author: { role: string }; content: { parts?: unknown[] } } | null }
    >;
  }>;
  return conversations.flatMap((conversation) =>
    Object.values(conversation.mapping).flatMap((node) => {
      const message = node.message;
      if (message === null || message.author.role !== "user") return [];
      return (message.content.parts ?? []).filter(
        (part): part is string => typeof part === "string",
      );
    }),
  );
}

// Every note line a test quote can come from: the people fixtures and the seeded turns.
function noteLines(): string[] {
  const fixtures = readdirSync(PEOPLE_DIR).flatMap((name) => {
    const text = readFileSync(join(PEOPLE_DIR, name), "utf8");
    return name.endsWith(".json") ? exportLines(text) : text.split("\n");
  });
  return [...fixtures, ...SEED_TURNS_A, ...SEED_TURNS_B].filter((line) => line.trim() !== "");
}

// The longest run of whole words of a line, at least QUOTE_MIN_CHARS long, that some normalised text contains; null when none does.
function sharedRun(line: string, texts: readonly string[]): string | null {
  const words = normQuote(line).split(" ");
  for (let start = 0; start < words.length; start += 1) {
    for (let end = words.length; end > start; end -= 1) {
      const run = words.slice(start, end).join(" ");
      if (run.length < QUOTE_MIN_CHARS) break;
      if (texts.some((text) => text.includes(run))) return run;
    }
  }
  return null;
}

it("R6.6-T2: no test note shares 20 or more characters with a meeting prompt, so the receipt check never refuses a real quote as prompt text", () => {
  const prompts = (
    ["meeting-moderator", "meeting-speech", "meeting-receipts", "untrusted-data-rules"] as const
  ).map((name) => normQuote(readPrompt(name).text));
  const shared = noteLines().flatMap((line) => {
    const run = sharedRun(line, prompts);
    return run === null ? [] : [run];
  });
  expect(shared).toEqual([]);
});
