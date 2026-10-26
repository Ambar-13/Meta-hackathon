import type { Transaction } from "kysely";
import { concedeArgs, ContractError, holdArgs, recallArgs, toolsForPhase, ToolName } from "@meet-first/contracts";
import { withMeeting, type Database } from "@meet-first/db";
import type { ChatMessage, ToolCall } from "@meet-first/llm";
import type { JobContext } from "../job-context.js";
import { saveRound } from "./claim-step.js";
import { appendMeetingEvent } from "./commit-turn.js";
import type { AssistantMessage, ToolMessage } from "./history-validator.js";
import { parseClaimLabel } from "./prompt-builder.js";
import { runRecall } from "./recall.js";
import type { RoundResult } from "./tool-loop.js";

// The step this runner holds, with what a round needs to know about it.
export type HeldStep = {
  meetingId: string; stepSeq: number; side: "a" | "b"; phase: "open" | "explore" | "decide"; attempt: number;
  toolRounds: number; personId: string; cardId: string; messages: ChatMessage[];
};

// The transaction and the held step one round writes under, with the time its events carry.
type Scope = { trx: Transaction<Database>; held: HeldStep; at: Date };
// What one tool call did: its tool message, and whether it was a concede or a hold.
type CallOutcome = { message: ToolMessage; isDecision: boolean };

// Runs one round's tool calls in call order in one transaction and saves the round (R5.1).
export async function runRoundTransaction(context: JobContext, held: HeldStep, round: { messages: ChatMessage[]; assistant: AssistantMessage; round: number }): Promise<RoundResult> {
  const at = context.now();
  const offered = new Set((toolsForPhase(held.phase, round.round) ?? []).map((tool) => tool.function.name));
  return withMeeting(context.db, held.meetingId, async (trx) => {
    const scope: Scope = { trx, held, at };
    const outcomes: CallOutcome[] = [];
    for (const call of round.assistant.tool_calls ?? []) outcomes.push(await runOneCall(scope, call, offered));
    const toolMessages = outcomes.map((outcome) => outcome.message);
    const isSaved = await saveRound(trx, held, { messages: [...round.messages, round.assistant, ...toolMessages], toolRounds: round.round });
    if (!isSaved) throw new ContractError("step_claim_lost", "Another runner took over this step, so this runner stops without writing.", 409);
    return { toolMessages, isDecision: outcomes.some((outcome) => outcome.isDecision) };
  });
}

// The tool message for a call that could not run, so the model reads why and the history stays valid (R5.1).
export function toolErrorMessage(toolCallId: string, sentence: string): ToolMessage {
  return { role: "tool", tool_call_id: toolCallId, content: "<tool_error>\n" + sentence + "\n</tool_error>" };
}

// Runs one call by the rules in order: unknown name, not offered now, bad arguments, then the tool itself.
async function runOneCall(scope: Scope, call: ToolCall, offered: ReadonlySet<string>): Promise<CallOutcome> {
  const name = ToolName.safeParse(call.function.name);
  if (!name.success) return refusal(call, "There is no tool named " + call.function.name.slice(0, 40) + ".");
  if (!offered.has(name.data)) return refusal(call, call.function.name + " is not available in this request.");
  const raw = parseJson(call.function.arguments);
  if (name.data === "recall") return runRecallCall(scope, call, recallArgs.safeParse(raw));
  if (name.data === "concede") return runConcedeCall(scope, call, concedeArgs.safeParse(raw));
  return runHoldCall(scope, call, holdArgs.safeParse(raw));
}

// The recall tool: search the speaker's notes, record the call and its result, and answer with the labelled turns.
async function runRecallCall(scope: Scope, call: ToolCall, parsed: ReturnType<typeof recallArgs.safeParse>): Promise<CallOutcome> {
  if (!parsed.success) return argsRefusal(call, "recall");
  const run = await runRecall(scope.trx, { cardId: scope.held.cardId, query: parsed.data.query });
  await recordCall(scope, "recall", parsed.data);
  await recordResult(scope, "recall", run.result);
  return { message: { role: "tool", tool_call_id: call.id, content: run.messageText }, isDecision: false };
}

// The concede tool: accept one of the other side's claims by its label, or record that the label named no such claim.
async function runConcedeCall(scope: Scope, call: ToolCall, parsed: ReturnType<typeof concedeArgs.safeParse>): Promise<CallOutcome> {
  if (!parsed.success) return argsRefusal(call, "concede");
  await recordCall(scope, "concede", parsed.data);
  const claimId = await findOtherClaim(scope, parsed.data.claimId);
  if (claimId === null) {
    await recordResult(scope, "concede", { recorded: false, error: "claim_not_found" });
    return refusal(call, "That claim is not one of the other side's claims. Use a label from other_claims.");
  }
  await appendMeetingEvent(scope.trx, { meetingId: scope.held.meetingId, type: "concede", fields: { stepSeq: scope.held.stepSeq, side: scope.held.side, claimId, reason: parsed.data.reason }, at: scope.at });
  await recordResult(scope, "concede", { recorded: true });
  return { message: recordedMessage(call.id), isDecision: true };
}

// The hold tool: keep the speaker's position, with the reason.
async function runHoldCall(scope: Scope, call: ToolCall, parsed: ReturnType<typeof holdArgs.safeParse>): Promise<CallOutcome> {
  if (!parsed.success) return argsRefusal(call, "hold");
  await recordCall(scope, "hold", parsed.data);
  await appendMeetingEvent(scope.trx, { meetingId: scope.held.meetingId, type: "hold", fields: { stepSeq: scope.held.stepSeq, side: scope.held.side, reason: parsed.data.reason }, at: scope.at });
  await recordResult(scope, "hold", { recorded: true });
  return { message: recordedMessage(call.id), isDecision: true };
}

// The id of the other side's claim a label names in this meeting, or null when there is none.
async function findOtherClaim(scope: Scope, claimId: string): Promise<string | null> {
  const label = parseClaimLabel(claimId);
  if (label === null) return null;
  const claim = await scope.trx.selectFrom("claims").select("id")
    .where("meeting_id", "=", scope.held.meetingId).where("step_seq", "=", label.stepSeq)
    .where("position", "=", label.position).where("side", "<>", scope.held.side)
    .executeTakeFirst();
  return claim?.id ?? null;
}

// Writes the tool.called event of one call.
async function recordCall(scope: Scope, tool: ToolName, args: Record<string, unknown>): Promise<void> {
  await appendMeetingEvent(scope.trx, { meetingId: scope.held.meetingId, type: "tool.called", fields: { stepSeq: scope.held.stepSeq, side: scope.held.side, tool, args }, at: scope.at });
}

// Writes the tool.result event of one call.
async function recordResult(scope: Scope, tool: ToolName, result: Record<string, unknown>): Promise<void> {
  await appendMeetingEvent(scope.trx, { meetingId: scope.held.meetingId, type: "tool.result", fields: { stepSeq: scope.held.stepSeq, side: scope.held.side, tool, result }, at: scope.at });
}

// A call that did not run: a tool error message and no event.
function refusal(call: ToolCall, sentence: string): CallOutcome {
  return { message: toolErrorMessage(call.id, sentence), isDecision: false };
}

// A call whose arguments do not match the tool's schema.
function argsRefusal(call: ToolCall, tool: ToolName): CallOutcome {
  return refusal(call, "The arguments of " + tool + " do not match its schema.");
}

// The tool message of a call that recorded something.
function recordedMessage(toolCallId: string): ToolMessage {
  return { role: "tool", tool_call_id: toolCallId, content: '{"recorded":true}' };
}

// The parsed JSON of a tool's arguments, or undefined when the text does not parse.
function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
