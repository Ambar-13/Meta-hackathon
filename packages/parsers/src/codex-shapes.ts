import type { RawTurn } from "./chatgpt-shapes.js";

// The file name of a Codex session log, one JSON object per line; Codex keeps them under ~/.codex/sessions.
export const CODEX_FILE_NAME = /\.jsonl$/i;
// Thread sources of the sessions Codex starts for its own helpers; their user lines are the helper's instructions, not the person's words.
const HELPER_THREAD_SOURCES: ReadonlyArray<string> = ["subagent", "guardian_review", "agent_created_thread"];
// The session source of a run that another program started as a tool call, so its user lines come from that program.
const TOOL_CALL_SOURCE = "mcp";
// An opening tag at the start of a text, such as <environment_context> or <in-app-browser-context source="tab">; group 1 is its name.
const OPENING_TAG = /^<([A-Za-z_][\w-]*)(?=[\s>/])/;
// A text that is one tag and nothing else, such as <image name=[Image #1]> or </image>.
const LONE_TAG = /^<\/?[A-Za-z_][\w-]*(?:\s[^<>]*)?>$/;
// The heading Codex puts right above the person's words when it adds files, quotes or page context to a message.
const REQUEST_HEADING = /^## My request(?: for Codex)?:[ \t]*$/gm;
// A line put where an imported message held something Codex could not carry over, such as an image.
const PLACEHOLDER_LINE = /^\[external unsupported block: [\w ]+\]$/gm;
// How a text part starts when Codex, or a Claude Code session imported into Codex, wrote it: instructions, context, summaries, markers.
const ADDED_TEXT_STARTS: ReadonlyArray<string> = [
  "# AGENTS.md instructions",
  "# Files mentioned by the user:",
  "# Context from my IDE setup:",
  "Another language model started to solve this problem",
  "This session is being continued from a previous conversation",
  "[Request interrupted by user",
];

// True when a value is a plain object, the only shape a session line or its payload can have.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One line read as a JSON object, or null when it is empty, not an object, or half written by a session that was still running.
function parseLine(text: string): Record<string, unknown> | null {
  if (text.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

// The user message a line holds: the payload of a response_item line, or the line itself in the older form; null for any other line.
function userMessageOf(line: Record<string, unknown>): Record<string, unknown> | null {
  const item = line.type === "response_item" && isRecord(line.payload) ? line.payload : line;
  return item.type === "message" && item.role === "user" ? item : null;
}

// True when a session line says Codex ran the session for one of its helpers (a sub-agent, a reviewer) or for another program's tool call.
function isHelperSession(line: Record<string, unknown>): boolean {
  const session = isRecord(line.payload) ? line.payload : {};
  if (isRecord(session.source) && "subagent" in session.source) return true;
  if (session.source === TOOL_CALL_SOURCE) return true;
  return typeof session.thread_source === "string" && HELPER_THREAD_SOURCES.includes(session.thread_source);
}

// The text left after the tagged blocks at its start, such as <environment_context>...</environment_context>; null when a block never closes.
function afterTaggedBlocks(text: string): string | null {
  let rest = text;
  for (let tag = OPENING_TAG.exec(rest); tag !== null; tag = OPENING_TAG.exec(rest)) {
    const closing = `</${tag[1] ?? ""}>`;
    const end = rest.lastIndexOf(closing);
    if (end === -1) return null;
    rest = rest.slice(end + closing.length).trimStart();
  }
  return rest;
}

// The text after the last request heading, or the whole text when it has none.
function afterRequestHeading(text: string): string {
  let start = 0;
  for (const heading of text.matchAll(REQUEST_HEADING)) start = heading.index + heading[0].length;
  return text.slice(start);
}

// The person's own words in one text part of a user message, or null when Codex wrote all of it.
function ownWords(part: string): string | null {
  const text = part.replace(PLACEHOLDER_LINE, "").trim();
  if (LONE_TAG.test(text)) return null;
  const untagged = afterTaggedBlocks(text);
  if (untagged === null) return null;
  const words = afterRequestHeading(untagged).trim();
  if (words === "" || ADDED_TEXT_STARTS.some((start) => words.startsWith(start))) return null;
  return words;
}

// The text of one user message: the person's own words from each input_text part, joined by a line break; "" when nothing is left.
function messageText(message: Record<string, unknown>): string {
  const content: unknown[] = Array.isArray(message.content) ? message.content : [];
  const words: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== "input_text" || typeof part.text !== "string") continue;
    const own = ownWords(part.text);
    if (own !== null) words.push(own);
  }
  return words.join("\n");
}

// Seconds since the epoch for a line's timestamp, or null when the line has none (the older form) or it is not a date.
function timeOf(timestamp: unknown): number | null {
  if (typeof timestamp !== "string") return null;
  const milliseconds = Date.parse(timestamp);
  return Number.isNaN(milliseconds) ? null : milliseconds / 1000;
}

// A Codex session log: the person's own messages in order, each with the time of its line. Reads user messages only and takes out
// what Codex added to them: project instructions, context blocks, image tags, everything above a request heading, summaries, and the
// markers of Claude Code sessions imported into Codex. A session Codex ran for a helper gives no turns, decided by its first session
// line. Repeats stay here; extractOwnTurns drops them across all the sessions of one upload.
export function parseCodexRollout(text: string): RawTurn[] {
  const turns: RawTurn[] = [];
  let hasSessionLine = false;
  for (const lineText of text.split("\n")) {
    const line = parseLine(lineText);
    if (line === null) continue;
    if (line.type === "session_meta" && !hasSessionLine) {
      if (isHelperSession(line)) return [];
      hasSessionLine = true;
    }
    const message = userMessageOf(line);
    const words = message === null ? "" : messageText(message);
    if (words !== "") turns.push({ text: words, exportOrder: turns.length, createTime: timeOf(line.timestamp) });
  }
  return turns;
}

// True for the lines parseCodexRollout reads: session lines and user message lines. The upload keeps only these while it streams a
// .jsonl file, so a session log of hundreds of megabytes never sits whole in memory. A line that names neither "user" nor
// session_meta is passed over without being parsed.
export function isCodexLineWanted(text: string): boolean {
  if (!text.includes("\"user\"") && !text.includes("session_meta")) return false;
  const line = parseLine(text);
  if (line === null) return false;
  return line.type === "session_meta" || userMessageOf(line) !== null;
}
