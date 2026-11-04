import { z } from "zod";
import type { RawTurn } from "./chatgpt-shapes.js";

// One message of Claude's export. Every field is optional because the export may leave any of them
// out.
const ClaudeChatMessage = z.object({
  sender: z.string().optional(),
  text: z.string().nullable().optional(),
  content: z.array(z.unknown()).optional(),
  created_at: z.string().nullable().optional(),
});

// The conversations of a root value: an array as it is, one object as a one-element array, anything
// else as none.
function conversationsOf(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  if (typeof root === "object" && root !== null) return [root];
  return [];
}

// True when a value is an object with a chat_messages array, the test for the Claude shape.
function hasChatMessages(value: unknown): value is { chat_messages: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { chat_messages?: unknown }).chat_messages)
  );
}

// The text of a Claude message: its text field when that is not empty, else the text entries of
// content joined by a line break.
function claudeText(message: z.infer<typeof ClaudeChatMessage>): string {
  if (typeof message.text === "string" && message.text !== "") return message.text;
  const pieces: string[] = [];
  for (const entry of message.content ?? []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { type, text } = entry as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") pieces.push(text);
  }
  return pieces.join("\n");
}

// Seconds since the epoch for an ISO time string, or null when the string is not a date.
function secondsOf(createdAt: string | null | undefined): number | null {
  if (typeof createdAt !== "string") return null;
  const milliseconds = Date.parse(createdAt);
  return Number.isNaN(milliseconds) ? null : milliseconds / 1000;
}

// The human turns of one conversation, in order. A message that does not parse, is not from the
// human, or has no text is skipped.
function humanTurns(messages: unknown[]): RawTurn[] {
  const turns: RawTurn[] = [];
  for (const message of messages) {
    const parsed = ClaudeChatMessage.safeParse(message);
    if (!parsed.success || parsed.data.sender !== "human") continue;
    const text = claudeText(parsed.data);
    if (text === "") continue;
    turns.push({ text, exportOrder: turns.length, createTime: secondsOf(parsed.data.created_at) });
  }
  return turns;
}

// Claude's export: an array of conversations with `chat_messages: [{ sender: "human" | "assistant",
// text, content: [{ type, text }] }]`. Keeps sender "human".
export function parseClaudeChatMessages(root: unknown): RawTurn[] | null {
  const shaped = conversationsOf(root).filter(hasChatMessages);
  if (shaped.length === 0) return null;
  const turns: RawTurn[] = [];
  for (const conversation of shaped) {
    for (const turn of humanTurns(conversation.chat_messages))
      turns.push({ ...turn, exportOrder: turns.length });
  }
  return turns;
}
