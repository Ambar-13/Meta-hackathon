import { ContractError, HTTP, type SourceKind, type Turn } from "@meet-first/contracts";
import { canonicalise, guessLang } from "./canonicalise.js";
import { parseChatGptMapping, parseChatGptMessages, type RawTurn } from "./chatgpt-shapes.js";
import { parseClaudeChatMessages } from "./claude-shapes.js";
import { CODEX_FILE_NAME, parseCodexRollout } from "./codex-shapes.js";
import { walkGeneric } from "./generic-walker.js";
import { computePersonaSignal } from "./persona-signal.js";
import { rankAndCut } from "./rank-and-cut.js";
import type { SummaryPriority } from "./summary-format.js";

// One file from the archive or the paste box, already read into memory by the worker.
export type ExtractInput = { name: string; text: string };

// What the worker gets back: the kept turns after ranking and cutting, the shape that matched, and the persona signal of the full set.
export type ExtractResult = {
  turns: Turn[];
  kind: SourceKind;
  personaSignal: number;
  foundTurns: number; // before the cut, for the "kept n of m" line on screen
  canonicalChars: number; // sum of text lengths after the cut, must be at most CANONICAL_TEXT_MAX_BYTES
};

// The sentence for a file that holds no messages written by the uploader.
const NO_OWN_TURNS_SENTENCE =
  "No messages written by you were found in this file. Pick the export file itself (conversations.json inside the zip), or paste some notes instead.";
// The sentence for a .json file that does not parse.
const NOT_JSON_SENTENCE = "This file is not a JSON export. Pick conversations.json from the zip, or paste text.";
// A byte order mark at the start of a JSON file, removed before parsing.
const JSON_BOM = /^﻿/;
// The start of a structured file: an optional byte order mark, spaces or line breaks, then an opening bracket or brace.
const STRUCTURED_START = /^﻿?\s*[[{]/;
// The name of a structured file: a .json export, or a Codex session log in .jsonl.
const STRUCTURED_NAME = /\.jsonl?$/i;
// The kind a Codex session is stored as. The frozen SourceKind has no codex kind, and Codex is OpenAI's agent, signed in with a
// ChatGPT account. The kind is stored with the source and shown nowhere on screen.
const CODEX_KIND: SourceKind = "chatgpt";
// Splits pasted text into blocks at one or more blank lines.
const BLANK_LINE = /\n\s*\n/;

// Which parser to try for one file, from its name and first bytes. JSON and Codex .jsonl go to the structured parsers; .md to notes;
// .txt or the paste box to paste.
export function detectKind(input: ExtractInput, kindHint: SourceKind | null): SourceKind {
  if (kindHint !== null) return kindHint;
  if (STRUCTURED_NAME.test(input.name) && STRUCTURED_START.test(input.text)) return "chatgpt";
  if (/\.md$/i.test(input.name)) return "notes";
  return "paste";
}

// Parses the text of a structured file, refusing a .json file that is not JSON.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(JSON_BOM, "")) as unknown;
  } catch {
    throw new ContractError("source_file_not_json", NOT_JSON_SENTENCE, HTTP.unprocessable);
  }
}

// The kind of a turn that the generic walker found: the hint when it names a structured kind, else from the file name.
function genericKind(input: ExtractInput, kindHint: SourceKind | null): SourceKind {
  if (kindHint === "chatgpt" || kindHint === "claude") return kindHint;
  const baseName = (input.name.split("/").pop() ?? "").toLowerCase();
  return baseName === "conversations.json" ? "chatgpt" : "claude";
}

// Runs the four structured parsers in order; the first that returns one or more turns wins and sets the kind.
function structuredTurns(input: ExtractInput, kindHint: SourceKind | null): { kind: SourceKind; turns: RawTurn[] } {
  const root = parseJson(input.text);
  const mapping = parseChatGptMapping(root);
  if (mapping !== null && mapping.length > 0) return { kind: "chatgpt", turns: mapping };
  const messages = parseChatGptMessages(root);
  if (messages !== null && messages.length > 0) return { kind: "chatgpt", turns: messages };
  const claude = parseClaudeChatMessages(root);
  if (claude !== null && claude.length > 0) return { kind: "claude", turns: claude };
  return { kind: genericKind(input, kindHint), turns: walkGeneric(root) };
}

// Notes and paste: the whole text split into blocks at blank lines, each block one turn.
function blockTurns(text: string): RawTurn[] {
  return canonicalise(text)
    .split(BLANK_LINE)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .map((block, index) => ({ text: block, exportOrder: index, createTime: null }));
}

// What reading one input gives: the kind its path sets, its raw turns, and whether a repeat of an earlier input's turn is dropped.
type InputRead = { kind: SourceKind; turns: RawTurn[]; dropsRepeats: boolean };

// Reads one input into raw turns and the kind its path gives. Only Codex sessions drop repeats (see withoutRepeats).
function readInput(input: ExtractInput, kindHint: SourceKind | null): InputRead {
  const path = detectKind(input, kindHint);
  if (path === "notes" || path === "paste") return { kind: path, turns: blockTurns(input.text), dropsRepeats: false };
  if (CODEX_FILE_NAME.test(input.name)) return { kind: CODEX_KIND, turns: parseCodexRollout(input.text), dropsRepeats: true };
  return { ...structuredTurns(input, kindHint), dropsRepeats: false };
}

// Canonicalises each turn and drops the ones with no character other than whitespace (step 3 of extractOwnTurns).
function canonicalTurns(turns: RawTurn[]): RawTurn[] {
  return turns.flatMap((turn) => {
    const text = canonicalise(turn.text);
    return /\S/.test(text) ? [{ ...turn, text }] : [];
  });
}

// The turns whose text no earlier input gave, with their texts added to the seen set. Codex copies a person's messages into forked
// and resumed sessions, so without this the same words would count two or more times.
function withoutRepeats(turns: RawTurn[], seen: Set<string>): RawTurn[] {
  return turns.filter((turn) => {
    if (seen.has(turn.text)) return false;
    seen.add(turn.text);
    return true;
  });
}

// Pulls the uploader's own turns out of any supported export. Throws source_no_own_turns when nothing is found.
// Order of attempts: ChatGPT 2024 mapping, ChatGPT 2026 messages, Claude chat_messages, generic walker, then notes or paste for plain text.
// A Codex .jsonl session log goes to the Codex reader, and a message repeated in a later session is kept once. With a summary, its
// quotes and topics decide first which messages are kept.
export function extractOwnTurns(inputs: ExtractInput[], kindHint: SourceKind | null, priority?: SummaryPriority): ExtractResult {
  const collected: RawTurn[] = [];
  const seenCodexTexts = new Set<string>();
  let kind: SourceKind | null = null;
  for (const input of inputs) {
    const read = readInput(input, kindHint);
    const canonical = canonicalTurns(read.turns);
    const turns = read.dropsRepeats ? withoutRepeats(canonical, seenCodexTexts) : canonical;
    if (turns.length === 0) continue;
    kind ??= read.kind;
    collected.push(...turns);
  }
  if (kind === null || collected.length === 0) {
    throw new ContractError("source_no_own_turns", NO_OWN_TURNS_SENTENCE, HTTP.unprocessable);
  }
  const candidates = collected.map((turn, index) => ({ ...turn, exportOrder: index, canonical: turn.text }));
  const personaSignal = computePersonaSignal(candidates.map((turn) => turn.canonical));
  const kept = rankAndCut(candidates, priority);
  const turns: Turn[] = kept.map((turn, index) => ({
    turnIndex: index,
    role: "user",
    text: turn.canonical,
    lang: guessLang(turn.canonical),
    sensitiveCategories: [],
  }));
  const canonicalChars = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  return { turns, kind, personaSignal, foundTurns: candidates.length, canonicalChars };
}
