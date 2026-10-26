import { createHash } from "node:crypto";
import { ReceiptsOutput, toStrictJsonSchema, type ToolDefinition } from "@meet-first/contracts";
import type { QuestionKind } from "@meet-first/contracts";
import type { ChatMessage, CompleteArgs, StreamArgs } from "@meet-first/llm";
import { MEETING_TURNS_MAX, type StepPhase } from "./agenda.js";

// The request cap of D40, in estimated tokens.
export const REQUEST_TOKEN_CAP = 60_000;
// At most this many prior committed turns enter a request (D40).
export const PRIOR_TURNS_MAX = 10;
// The fewest characters the moderator and speech prompts together may hold, so every prefix is above 4,000 tokens at 4 characters per token (ARCHITECTURE.md 4.7: the vendor's minimum cached prefix is unverified) [confirm].
export const PREFIX_MIN_CHARS = 16_000;
// Hex characters of the prefix hash kept in the prompt cache key [confirm].
export const CACHE_KEY_HASH_CHARS = 32;
// The front of every claim label. A label has the shape of a uuid, so concedeArgs accepts it, and holds only the step and the position, so a request never carries a database id [confirm].
export const CLAIM_LABEL_PREFIX = "00000000-0000-4000-8000-";

// The three prompt texts every prefix starts with, read by readPrompt (seams S7).
export type PromptTexts = { moderator: string; speech: string; untrustedRules: string };
// One approved card item as the prefix shows it; turnIndex is turns.turn_index of the item's turn.
export type PrefixItem = { position: number; kind: string; claim: string; lang: string; gloss: string; quote: string; turnIndex: number };
// Everything one side's prefix holds (ARCHITECTURE.md 4.7).
export type PrefixInput = { texts: PromptTexts; question: string; questionKind: QuestionKind; side: "a" | "b"; ownName: string; otherName: string; items: readonly PrefixItem[]; misses: readonly string[] };
// One committed turn as a later request shows it.
export type PromptTurn = { stepSeq: number; side: "a" | "b"; phase: StepPhase; text: string };
// One claim of the other side, shown in the decide phase so a concede can name it.
export type PromptClaim = { stepSeq: number; position: number; text: string; quote: string };
// Everything one step's variable part holds.
export type VariableInput = {
  stepSeq: number; side: "a" | "b"; phase: StepPhase;
  turns: readonly PromptTurn[]; droppedTurns: number; otherClaims: readonly PromptClaim[];
};

// One prompt as a step uses it: its text and the version readPrompt read.
export type LoadedPrompt = { text: string; version: string };
// The four prompts a speech step reads (seams S7).
export type MeetingPrompts = { moderator: LoadedPrompt; speech: LoadedPrompt; receipts: LoadedPrompt; untrustedRules: LoadedPrompt };

// The byte-identical system prefix of one side, built once before the meeting starts and stored in meeting_members.frozen_prefix (D41, invariant 17).
export function buildFrozenPrefix(input: PrefixInput): string {
  const sections = [
    input.texts.moderator.trimEnd(),
    input.texts.speech.trimEnd(),
    input.texts.untrustedRules.trimEnd(),
    "<meeting_question kind=\"" + input.questionKind + "\">\n" + escapeBlockText(input.question) + "\n</meeting_question>",
    "<people>\nyour human: " + promptName(input.ownName) + "\nthe other human: " + promptName(input.otherName) + "\nyou speak for side: " + input.side + "\n</people>",
    "<your_card>\n" + renderItems(input.items) + "\n</your_card>",
  ];
  if (input.misses.length > 0) {
    sections.push("<do_not_guess>\n" + input.misses.map((text) => "- " + text).join("\n") + "\n</do_not_guess>");
  }
  return sections.join("\n\n") + "\n";
}

// The prompt cache key of one side: a hash of its prefix, so the same prefix always gives the same key and a replayed request finds its fixture (D41 [confirm]).
export function promptCacheKey(frozenPrefix: string, side: "a" | "b"): string {
  const hash = createHash("sha256").update(frozenPrefix, "utf8").digest("hex").slice(0, CACHE_KEY_HASH_CHARS);
  return "meeting:" + hash + ":" + side;
}

// The user message after the prefix: the meeting state, the transcript inside untrusted tags, and the other side's claims in decide (R7.3, D42).
export function buildVariablePart(input: VariableInput): string {
  const parts = [stateBlock(input), transcriptBlock(input)];
  if (input.phase === "decide" && input.otherClaims.length > 0) parts.push(otherClaimsBlock(input.otherClaims));
  parts.push("Write your turn " + String(input.stepSeq) + " now.");
  return parts.join("\n\n");
}

// Keeps the last 10 turns, then drops the oldest explore turns, then the oldest open turns, until the request is at or under 60,000 estimated tokens (D40).
export function capTurns(prefix: string, input: VariableInput, charsPerToken: number): { input: VariableInput; isOverCap: boolean } {
  let current = keepRecentTurns(input);
  let smaller = dropOneTurn(current);
  while (tokenSize(prefix, current, charsPerToken) > REQUEST_TOKEN_CAP && smaller !== null) {
    current = smaller;
    smaller = dropOneTurn(current);
  }
  return { input: current, isOverCap: tokenSize(prefix, current, charsPerToken) > REQUEST_TOKEN_CAP };
}

// The first two messages of every speech request of a step: the frozen prefix as the system message, then the variable part.
export function initialMessages(prefix: string, variablePart: string): ChatMessage[] {
  return [
    { role: "system", content: prefix },
    { role: "user", content: variablePart },
  ];
}

// The label a turn has in every prompt: t: and its turn_index inside its source, the same short form as the card build's [t:1234] labels (D26) [confirm].
export function turnLabel(turnIndex: number): string {
  return "t:" + String(turnIndex);
}

// The label a claim has in a decide prompt, built from its step and position ([confirm]).
export function claimLabel(stepSeq: number, position: number): string {
  return CLAIM_LABEL_PREFIX + String(stepSeq).padStart(8, "0") + String(position).padStart(4, "0");
}

// Reads a claim label back into its step and position; null when the text is not a claim label.
export function parseClaimLabel(label: string): { stepSeq: number; position: number } | null {
  const match = /^00000000-0000-4000-8000-(\d{8})(\d{4})$/.exec(label);
  if (match === null) return null;
  const stepSeq = Number(match[1]);
  const position = Number(match[2]);
  if (stepSeq < 1 || position < 1) return null;
  return { stepSeq, position };
}

// The LlmClient arguments of one speech request, without the two hooks. The job and the fixture writer both use it, so a fixture's body is the job's body (D74).
export function speechCallArgs(input: { meetingId: string; promptVersion: string; messages: ChatMessage[]; tools: ToolDefinition[] | undefined; cacheKey: string }): Omit<StreamArgs, "onDelta" | "onFirstToken"> {
  return {
    callSite: "speech",
    promptVersion: input.promptVersion,
    messages: input.messages,
    ...(input.tools === undefined ? {} : { tools: input.tools }),
    promptCacheKey: input.cacheKey,
    ledger: { personId: null, meetingId: input.meetingId },
  };
}

// The LlmClient arguments of one receipts request (D39).
export function receiptsCallArgs(input: { meetingId: string; promptVersion: string; messages: ChatMessage[] }): CompleteArgs {
  return {
    callSite: "receipts",
    promptVersion: input.promptVersion,
    messages: input.messages,
    schema: toStrictJsonSchema(ReceiptsOutput, "meeting-receipts"),
    ledger: { personId: null, meetingId: input.meetingId },
  };
}

// The texts a quote may never repeat: the question and the four prompt texts (D25, R6.6).
export function forbiddenTexts(question: string, prompts: MeetingPrompts): string[] {
  return [question, prompts.moderator.text, prompts.speech.text, prompts.receipts.text, prompts.untrustedRules.text];
}

// The item block of the prefix: the approved items in position order, or a line saying there are none.
function renderItems(items: readonly PrefixItem[]): string {
  if (items.length === 0) return "(no approved items)";
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ["item " + String(item.position) + " (" + item.kind + ")", "claim: " + item.claim, "quote from [" + turnLabel(item.turnIndex) + "]: \"" + item.quote + "\"", "gloss: " + item.gloss, "language: " + item.lang].join("\n"))
    .join("\n\n");
}

// The state block of the variable part: the phase, the turn number of the speech and the side.
function stateBlock(input: VariableInput): string {
  return ["<meeting_state>", "phase: " + input.phase, "turn: " + String(input.stepSeq) + " of at most " + String(MEETING_TURNS_MAX), "you speak for side: " + input.side, "</meeting_state>"].join("\n");
}

// The transcript block: the earlier-turns note, then each committed turn in step order, tagged by side.
function transcriptBlock(input: VariableInput): string {
  const lines: string[] = [];
  if (input.droppedTurns > 0) lines.push("(" + String(input.droppedTurns) + " earlier turns are left out to keep the request under its size cap.)");
  if (input.turns.length === 0 && input.droppedTurns === 0) lines.push("(no turns yet)");
  for (const row of sortedByStep(input.turns)) lines.push(turnBlock(row, input.side));
  return "<transcript>\n" + lines.join("\n") + "\n</transcript>";
}

// One committed turn: a turn of the speaking side is your_turn, a turn of the other side is other_persona.
function turnBlock(row: PromptTurn, speakingSide: "a" | "b"): string {
  const tag = row.side === speakingSide ? "your_turn" : "other_persona";
  return "<" + tag + ' turn="' + String(row.stepSeq) + '" phase="' + row.phase + '">\n' + escapeBlockText(row.text) + "\n</" + tag + ">";
}

// The other side's claims with their labels, in step and position order.
function otherClaimsBlock(claims: readonly PromptClaim[]): string {
  const blocks = [...claims]
    .sort((a, b) => a.stepSeq - b.stepSeq || a.position - b.position)
    .map((claim) => "claim " + claimLabel(claim.stepSeq, claim.position) + ": " + escapeBlockText(claim.text) + "\nquote: \"" + escapeBlockText(claim.quote) + "\"");
  return "<other_claims>\n" + blocks.join("\n\n") + "\n</other_claims>";
}

// The turns in ascending step order, without changing the array it was given.
function sortedByStep(turns: readonly PromptTurn[]): PromptTurn[] {
  return [...turns].sort((a, b) => a.stepSeq - b.stepSeq);
}

// Keeps the last PRIOR_TURNS_MAX turns and counts the ones left out (D40).
function keepRecentTurns(input: VariableInput): VariableInput {
  if (input.turns.length <= PRIOR_TURNS_MAX) return input;
  const sorted = sortedByStep(input.turns);
  const kept = sorted.slice(sorted.length - PRIOR_TURNS_MAX);
  return { ...input, turns: kept, droppedTurns: input.droppedTurns + (sorted.length - kept.length) };
}

// The input with one more turn left out: the explore turn with the lowest step, or else the open turn with the lowest step; decide turns stay (D40).
function dropOneTurn(input: VariableInput): VariableInput | null {
  const explore = sortedByStep(input.turns.filter((row) => row.phase === "explore"));
  const open = sortedByStep(input.turns.filter((row) => row.phase === "open"));
  const victim = explore[0] ?? open[0];
  if (victim === undefined) return null;
  return { ...input, turns: input.turns.filter((row) => row !== victim), droppedTurns: input.droppedTurns + 1 };
}

// The estimated size of the request in tokens: the prefix and the variable part, at the given characters per token.
function tokenSize(prefix: string, input: VariableInput, charsPerToken: number): number {
  return Math.ceil((prefix.length + buildVariablePart(input).length) / charsPerToken);
}

// Escapes the three characters that could open or close a block tag. It is used on text another person can write: the
// question, the turns and the other side's claims (R7.3; the quiz uses the same rule). A persona's own card items are not
// escaped, because its quotes must match its own turns exactly for the receipts check.
function escapeBlockText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// A display name on one line with no tag characters, so a name cannot add a line or a tag to the people block.
function promptName(name: string): string {
  return name.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/[<>&]/g, "").replace(/ {2,}/g, " ").trim();
}

