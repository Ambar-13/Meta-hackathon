import { ContractError, PARTIAL_FLUSH_MS, REFUSAL_TEXT, TOOL_ROUNDS_MAX, toolsForPhase, type ToolDefinition } from "@meet-first/contracts";
import type { ChatMessage, ToolCall } from "@meet-first/llm";
import type { StepPhase } from "./agenda.js";
import type { AssistantMessage, ToolMessage } from "./history-validator.js";

// Speech requests one step may make: 4 tool rounds, and the 5th request carries no tools field (D37).
export const SPEECH_REQUESTS_MAX = TOOL_ROUNDS_MAX + 1;
// The reason recorded when a decide turn made no concede or hold call (D42).
export const NO_DECISION_REASON = "no explicit decision";
// The text between two rounds of one turn, on screen and in the committed turn [confirm].
export const ROUND_TEXT_SEPARATOR = "\n\n";

// One speech request's result, as the step job's speak function returns it.
export type SpeakResult = { text: string; toolCalls: ToolCall[]; finishReason: "stop" | "length" | "tool_calls" };
// Sends one speech request; tools undefined means the request has no tools field at all (D37).
export type SpeakFn = (request: { messages: ChatMessage[]; tools: ToolDefinition[] | undefined; round: number }) => Promise<SpeakResult>;
// What the tool calls of one round did, after the round was saved in one transaction (section 4.9).
export type RoundResult = { toolMessages: ToolMessage[]; isDecision: boolean };
// Runs and saves the tool calls of one round; messages are the step's messages before this round.
export type RunRoundFn = (round: { messages: ChatMessage[]; assistant: AssistantMessage; round: number }) => Promise<RoundResult>;
// Where a step's speech stands when the loop starts.
export type SpeechState = { phase: StepPhase; messages: ChatMessage[]; requestsMade: number; hasDecision: boolean };
// How the loop ended: the final turn text, the requests made, and whether a concede or hold was recorded.
export type SpeechOutcome = { text: string; requestsMade: number; hasDecision: boolean };

// The functions one speech run calls: the speech request, the round save and the discard of a cut round.
type SpeechDeps = { speak: SpeakFn; runRound: RunRoundFn; discardRound: () => Promise<void> };
// One speech request as the loop sends it.
type SpeakRequest = { messages: ChatMessage[]; tools: ToolDefinition[] | undefined; round: number };

// Runs speech requests until the model stops with text or the 5th request (with no tools) answers (D37, D43, R10.7).
export async function runSpeechRounds(state: SpeechState, deps: SpeechDeps): Promise<SpeechOutcome> {
  let messages: ChatMessage[] = [...state.messages];
  let requestsMade = state.requestsMade;
  let hasDecision = state.hasDecision;
  while (requestsMade < SPEECH_REQUESTS_MAX) {
    const round = requestsMade + 1;
    const tools = toolsForPhase(state.phase, round);
    const result = await speakRound(deps, { messages, tools, round });
    requestsMade = round;
    if (!isToolRound(result, tools)) return finishTurn(messages, result.text, { requestsMade, hasDecision });
    const assistant: AssistantMessage = { role: "assistant", content: result.text === "" ? null : result.text, tool_calls: result.toolCalls };
    const outcome = await deps.runRound({ messages, assistant, round });
    messages = [...messages, assistant, ...outcome.toolMessages];
    hasDecision = hasDecision || outcome.isDecision;
  }
  return finishTurn(messages, "", { requestsMade, hasDecision });
}

// The texts of a turn so far, joined: each stored assistant text, then the current round's text.
export function joinTurnText(messages: readonly ChatMessage[], currentText: string): string {
  const texts: string[] = [];
  for (const message of messages.slice(2)) {
    if (message.role === "assistant" && typeof message.content === "string" && message.content.trim() !== "") texts.push(message.content.trim());
  }
  if (currentText.trim() !== "") texts.push(currentText.trim());
  return texts.join(ROUND_TEXT_SEPARATOR);
}

// True for the two errors after which the round is discarded and retried once (dossier client: model_stream_cut, model_stream_length; R10.7).
export function isRoundBreak(error: unknown): boolean {
  return error instanceof ContractError && (error.code === "model_stream_cut" || error.code === "model_stream_length");
}

// Keeps the text of one attempt and writes it at most every 250 ms and at the end of each round (D47).
export class PartialTextWriter {
  private base: string;
  private current = "";
  private lastWritten: string;
  private lastWriteAt: Date;
  private readonly deps: { write: (text: string) => Promise<void>; now: () => Date };

  constructor(deps: { write: (text: string) => Promise<void>; now: () => Date }, baseText: string, lastWriteAt: Date) {
    this.deps = deps;
    this.base = baseText;
    this.lastWritten = baseText;
    this.lastWriteAt = lastWriteAt;
  }

  // Adds one streamed slice and writes when 250 ms or more passed since the last write (D47).
  async append(slice: string): Promise<void> {
    this.current += slice;
    if (this.deps.now().getTime() - this.lastWriteAt.getTime() >= PARTIAL_FLUSH_MS) await this.flush();
  }

  // Writes when the text differs from the last text written.
  async flush(): Promise<void> {
    const text = this.text;
    if (text === this.lastWritten) return;
    await this.deps.write(text);
    this.lastWritten = text;
    this.lastWriteAt = this.deps.now();
  }

  // Drops the current round's slices, for the retry of a cut round (R10.7), and writes the shorter text.
  async discardRound(): Promise<void> {
    this.current = "";
    await this.flush();
  }

  // Ends a round: the text so far becomes the base the next round adds to.
  endRound(): void {
    this.base = this.text;
    this.current = "";
  }

  // The text so far: the base, then the separator and the current round when both are non-empty.
  get text(): string {
    if (this.current === "") return this.base;
    if (this.base === "") return this.current;
    return this.base + ROUND_TEXT_SEPARATOR + this.current;
  }
}

// One speech request. A round that breaks (a cut stream or a length stop) comes back as null; other errors are thrown.
async function attemptSpeak(speak: SpeakFn, request: SpeakRequest): Promise<SpeakResult | null> {
  try {
    const result = await speak(request);
    return result.finishReason === "length" ? null : result;
  } catch (error) {
    if (isRoundBreak(error)) return null;
    throw error;
  }
}

// One round: a broken round is discarded and run once more with the same messages (R10.7). A second break that throws is rethrown as it is.
async function speakRound(deps: SpeechDeps, request: SpeakRequest): Promise<SpeakResult> {
  const first = await attemptSpeak(deps.speak, request);
  if (first !== null) return first;
  await deps.discardRound();
  const retry = await deps.speak(request);
  if (retry.finishReason === "length") {
    throw new ContractError("speech_cut", "The speech round was cut twice. The step stops and the sweeper retries it.", 502);
  }
  return retry;
}

// True when the reply holds tool calls and the request offered tools, so the calls must run (D37).
function isToolRound(result: SpeakResult, tools: ToolDefinition[] | undefined): boolean {
  return result.finishReason === "tool_calls" && tools !== undefined && result.toolCalls.length > 0;
}

// The outcome of a turn: the joined text, or the fixed refusal sentence when the text is empty (D43).
function finishTurn(messages: readonly ChatMessage[], currentText: string, counts: { requestsMade: number; hasDecision: boolean }): SpeechOutcome {
  const text = joinTurnText(messages, currentText);
  return { text: text === "" ? REFUSAL_TEXT : text, requestsMade: counts.requestsMade, hasDecision: counts.hasDecision };
}
