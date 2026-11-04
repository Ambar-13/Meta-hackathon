import { ContractError } from "@meet-first/contracts";
import type { ChatMessage } from "@meet-first/llm";

// A tool result message, as the speech call sends it.
export type ToolMessage = Extract<ChatMessage, { role: "tool" }>;
// An assistant message, with or without tool calls.
export type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

// The first rule a stored message breaks, and where it sits.
type Fault = { reason: string; index: number };
// The tool calls of the last assistant message and the ones already answered.
type Pending = { open: Set<string>; answered: Set<string> };

// Throws history_invalid unless the messages are: the system prefix, one user message, then assistant messages each
// followed by exactly one tool message per tool call, in any order of ids.
export function assertValidHistory(messages: readonly ChatMessage[]): void {
  const fault = prefixFault(messages) ?? walkFault(messages);
  if (fault === null) return;
  throw new ContractError(
    "history_invalid",
    "The stored messages of this step break the tool call order (" +
      fault.reason +
      " at message " +
      String(fault.index) +
      "). The step stops and the sweeper retries it.",
    500,
  );
}

// The fault in the prefix: the system message, then one user message.
function prefixFault(messages: readonly ChatMessage[]): Fault | null {
  const isPrefixOk =
    messages.length >= 2 && messages[0]?.role === "system" && messages[1]?.role === "user";
  return isPrefixOk ? null : { reason: "missing_prefix", index: 0 };
}

// The first fault after the prefix, walking the messages in order; a call still unanswered at the end is a fault too.
function walkFault(messages: readonly ChatMessage[]): Fault | null {
  const pending: Pending = { open: new Set(), answered: new Set() };
  for (const [offset, message] of messages.slice(2).entries()) {
    const fault = applyMessage(message, offset + 2, pending);
    if (fault !== null) return fault;
  }
  return hasUnanswered(pending) ? { reason: "unanswered_tool_call", index: messages.length } : null;
}

// Applies one message to the pending calls and returns the rule it breaks, if any.
function applyMessage(message: ChatMessage, index: number, pending: Pending): Fault | null {
  if (message.role === "assistant") {
    if (hasUnanswered(pending)) return { reason: "unanswered_tool_call", index };
    pending.open = new Set((message.tool_calls ?? []).map((call) => call.id));
    pending.answered = new Set();
    return null;
  }
  if (message.role === "tool") return applyToolMessage(message.tool_call_id, index, pending);
  return { reason: "unexpected_role", index };
}

// Applies one tool result: its call must be open and not yet answered.
function applyToolMessage(toolCallId: string, index: number, pending: Pending): Fault | null {
  if (!pending.open.has(toolCallId)) return { reason: "tool_without_call", index };
  if (pending.answered.has(toolCallId)) return { reason: "tool_answered_twice", index };
  pending.answered.add(toolCallId);
  return null;
}

// True when some call of the last assistant message has no result yet.
function hasUnanswered(pending: Pending): boolean {
  return [...pending.open].some((id) => !pending.answered.has(id));
}
