import { expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import type { ChatMessage } from "@meet-first/llm";
import { assertValidHistory } from "./history-validator.js";

// The system prefix message, as the speech job stores it.
const sys: ChatMessage = { role: "system", content: "p" };
// The user message after the prefix.
const usr: ChatMessage = { role: "user", content: "v" };

// One tool call of an assistant message.
function call(id: string, name: string) {
  return { id, type: "function" as const, function: { name, arguments: "{}" } };
}

// One tool result message for a call id.
function tool(id: string): ChatMessage {
  return { role: "tool", tool_call_id: id, content: "r" };
}

// Runs the history check on these messages and returns the ContractError it throws; fails the test
// when it does not throw one.
function errorOf(messages: readonly ChatMessage[]): ContractError {
  try {
    assertValidHistory(messages);
  } catch (error) {
    if (error instanceof ContractError) return error;
    throw error;
  }
  throw new Error("The check did not throw.");
}

it("R5.1-T1: a tool message with no assistant message before it is rejected", () => {
  const failure = errorOf([sys, usr, tool("call_1")]);
  expect(failure.code).toBe("history_invalid");
  expect(failure.message).toContain("tool_without_call at message 2");
});

it("R5.1-T2: tool results in any order after their assistant message are accepted", () => {
  const history: ChatMessage[] = [
    sys,
    usr,
    {
      role: "assistant",
      content: null,
      tool_calls: [call("call_1", "recall"), call("call_2", "recall")],
    },
    tool("call_2"),
    tool("call_1"),
  ];
  expect(() => {
    assertValidHistory(history);
  }).not.toThrow();
});

it("R5.1-T3: an unanswered tool call is rejected before the next request", () => {
  const history: ChatMessage[] = [
    sys,
    usr,
    { role: "assistant", content: null, tool_calls: [call("call_1", "recall")] },
  ];
  const failure = errorOf(history);
  expect(failure.code).toBe("history_invalid");
  expect(failure.message).toContain("unanswered_tool_call at message 3");
});

it("R5.1-T4: a tool call answered twice is rejected", () => {
  const history: ChatMessage[] = [
    sys,
    usr,
    { role: "assistant", content: null, tool_calls: [call("call_1", "recall")] },
    tool("call_1"),
    tool("call_1"),
  ];
  const failure = errorOf(history);
  expect(failure.code).toBe("history_invalid");
  expect(failure.message).toContain("tool_answered_twice at message 4");
});

it("R5.1-T5: a system message after the prefix is rejected", () => {
  const failure = errorOf([sys, usr, sys]);
  expect(failure.code).toBe("history_invalid");
  expect(failure.message).toContain("unexpected_role at message 2");
});

it("R5.1-T6: a history without the prefix is rejected", () => {
  const failure = errorOf([usr]);
  expect(failure.code).toBe("history_invalid");
  expect(failure.message).toContain("missing_prefix at message 0");
});
