import { NamesPassOutput, toStrictJsonSchema, type CallSite } from "@meet-first/contracts";
import type { ChatMessage } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";

// The longest text one names-pass call receives: 100,000 characters of whole turns (D15).
export const NAMES_CHUNK_MAX_CHARS = 100_000;
// Two turn blocks are joined with one blank line.
export const TURN_BLOCK_SEPARATOR = "\n\n";
// One model call as a job builds it, before the ledger is added; the fixture test hashes exactly this (section 5.6).
export type ModelCall = { callSite: CallSite; promptVersion: string; messages: ChatMessage[]; schema: ReturnType<typeof toStrictJsonSchema> };

// One turn as the names pass and the card build show it: its label, a space, then its text (ARCHITECTURE.md section 5 step 7).
export function formatTurnBlock(turn: { turnIndex: number; text: string }): string {
  return `[t:${String(turn.turnIndex)}] ${turn.text}`;
}

// Splits turns into chunks of whole turns whose joined blocks are at most NAMES_CHUNK_MAX_CHARS; a turn is never split (D15).
export function chunkTurnsForNames(turns: ReadonlyArray<{ turnIndex: number; text: string }>): Array<{ turnIndexes: number[]; text: string }> {
  const chunks: Array<{ turnIndexes: number[]; text: string }> = [];
  let current: { turnIndexes: number[]; text: string } | null = null;
  const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
  for (const turn of ordered) {
    const block = formatTurnBlock(turn);
    if (current !== null && current.text.length + TURN_BLOCK_SEPARATOR.length + block.length <= NAMES_CHUNK_MAX_CHARS) {
      current.text += TURN_BLOCK_SEPARATOR + block;
      current.turnIndexes.push(turn.turnIndex);
    } else {
      if (current !== null) chunks.push(current);
      current = { turnIndexes: [turn.turnIndex], text: block };
    }
  }
  if (current !== null) chunks.push(current);
  return chunks;
}

// The names-pass call for one chunk: the scrub-names prompt and the untrusted-data rules as the system message, the allowlist and the chunk as the user message (D15, D17).
export function namesPassCall(input: { allowlist: readonly string[]; chunkText: string }): ModelCall {
  const prompt = readPrompt("scrub-names");
  const rules = readPrompt("untrusted-data-rules");
  return {
    callSite: "scrub_names",
    promptVersion: prompt.version,
    messages: [
      { role: "system", content: `${prompt.text}\n\n${rules.text}` },
      { role: "user", content: `<allowlist>\n${input.allowlist.join("\n")}\n</allowlist>\n<source_turns>\n${input.chunkText}\n</source_turns>` },
    ],
    schema: toStrictJsonSchema(NamesPassOutput, "scrub-names"),
  };
}
