import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isCodexLineWanted, parseCodexRollout } from "./codex-shapes.js";

// Reads the synthetic Codex session from packages/parsers/fixtures as text.
async function codexFixture(): Promise<string> {
  return readFile(new URL("../fixtures/codex-session.jsonl", import.meta.url), "utf8");
}

// One line of a session log in the form Codex writes now: a time, a type and a payload.
function line(type: string, payload: unknown): string {
  return JSON.stringify({ timestamp: "2026-10-02T08:00:00.000Z", type, payload });
}

// The session line Codex writes first, with the given source and thread source.
function sessionLine(source: unknown, threadSource?: string): string {
  return line("session_meta", { id: "0199a1b2-0000-7000-8000-000000000002", source, thread_source: threadSource });
}

// A user message line with one text part.
function userLine(text: string): string {
  return line("response_item", { type: "message", role: "user", content: [{ type: "input_text", text }] });
}

// The texts of the turns read from the given lines.
function textsOf(lines: string[]): string[] {
  return parseCodexRollout(lines.join("\n")).map((turn) => turn.text);
}

describe("parseCodexRollout", () => {
  it("R1.1-T26: keeps the person's own words in order, with the time of each line, repeats included", async () => {
    const turns = parseCodexRollout(await codexFixture());
    expect(turns.map((turn) => turn.text)).toEqual([
      "I want the watering reminders to feel gentle, because I forget my plants when I am stressed.",
      "Can you match the colours on this page? I like how calm it looks.",
      "This is my balcony, and I only get morning sun.",
      "I wrote this plan at midnight, so please be kind to it.",
      "I drew the layout on paper first, because that is how I think.",
      "I want the watering reminders to feel gentle, because I forget my plants when I am stressed.",
      "yes, go ahead",
    ]);
    expect(turns[0]?.createTime).toBe(1_790_928_060);
    expect(turns.map((turn) => turn.exportOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("R1.1-T27: drops what Codex added to user messages: instructions, context blocks, image tags, summaries and imported markers", async () => {
    const joined = parseCodexRollout(await codexFixture()).map((turn) => turn.text).join("\n");
    for (const added of [
      "AGENTS.md",
      "Use tabs",
      "environment_context",
      "zsh",
      "in-app-browser-context",
      "example.com",
      "## My request",
      "Files mentioned",
      "plan.md",
      "Context from my IDE setup",
      "<image",
      "</image>",
      "Request interrupted",
      "continued from a previous conversation",
      "external unsupported block",
      "turn_aborted",
      "Another language model",
      "npm test",
      "Ask before you run a command.",
      "Here is a gentler reminder schedule",
      "The user wants gentle reminders.",
      "An old message that only the summary keeps.",
    ]) {
      expect(joined).not.toContain(added);
    }
  });

  it("R1.1-T28: skips sessions Codex ran for its own helpers: sub-agents, reviewers, MCP calls and agent-made threads", () => {
    const words = userLine("Review this command before it runs: rm -rf build");
    expect(textsOf([sessionLine({ subagent: { other: "guardian" } }, "guardian_review"), words])).toEqual([]);
    expect(textsOf([sessionLine({ subagent: { thread_spawn: { parent_thread_id: "t1", depth: 1 } } }, "subagent"), words])).toEqual([]);
    expect(textsOf([sessionLine("mcp"), words])).toEqual([]);
    expect(textsOf([sessionLine("vscode", "agent_created_thread"), words])).toEqual([]);
    expect(textsOf([sessionLine("vscode", "user"), words])).toEqual(["Review this command before it runs: rm -rf build"]);
    expect(textsOf([sessionLine("vscode", "chatgpt_handoff"), words])).toEqual(["Review this command before it runs: rm -rf build"]);
  });

  it("R1.1-T29: the first session line decides, so a helper that copied the person's history is still skipped", () => {
    const helper = [sessionLine({ subagent: { thread_spawn: { depth: 1 } } }, "subagent"), sessionLine("vscode", "user"), userLine("I copied this from the parent thread.")];
    expect(textsOf(helper)).toEqual([]);
    const person = [sessionLine("vscode", "user"), sessionLine({ subagent: { other: "guardian" } }, "guardian_review"), userLine("I am the person here.")];
    expect(textsOf(person)).toEqual(["I am the person here."]);
  });

  it("R1.1-T30: reads the older Codex form, where each line is the message itself and the first line has no type", () => {
    const lines = [
      JSON.stringify({ id: "0199a1b2-0000-7000-8000-000000000003", timestamp: "2025-06-01T10:00:00Z", instructions: null }),
      JSON.stringify({ record_type: "state" }),
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "<user_instructions>\nBe brief.\n</user_instructions>" }] }),
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "I like small commits that I can explain in one line." }] }),
      JSON.stringify({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Noted." }] }),
    ];
    const turns = parseCodexRollout(lines.join("\n"));
    expect(turns).toEqual([{ text: "I like small commits that I can explain in one line.", exportOrder: 0, createTime: null }]);
  });

  it("R1.1-T31: a context block with no closing tag is dropped whole, and a half-written line is skipped", () => {
    const lines = [
      sessionLine("cli", "user"),
      userLine("<environment_context>\n  <cwd>/home/sam</cwd>"),
      userLine("I check the weather before I plan a weekend."),
      "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_te",
    ];
    expect(textsOf(lines)).toEqual(["I check the weather before I plan a weekend."]);
  });

  it("R1.1-T36: the words after a context block stay when no request heading marks them", () => {
    const lines = [sessionLine("vscode", "user"), userLine("<in-app-browser-context source=\"tab\">\nhttps://example.com\n</in-app-browser-context>\nI read this every morning.")];
    expect(textsOf(lines)).toEqual(["I read this every morning."]);
  });
});

describe("isCodexLineWanted", () => {
  it("R1.1-T32: keeps session lines and user message lines, and nothing else", () => {
    const fixtureLines = [
      sessionLine("cli", "user"),
      userLine("I keep a list of plants I have killed."),
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "Older form." }] }),
    ];
    for (const wanted of fixtureLines) expect(isCodexLineWanted(wanted)).toBe(true);
    const unwanted = [
      line("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Tell the user." }] }),
      line("response_item", { type: "message", role: "developer", content: [{ type: "input_text", text: "The user is a gardener." }] }),
      line("response_item", { type: "reasoning", summary: [{ type: "summary_text", text: "The user wants gentle reminders." }] }),
      line("response_item", { type: "function_call_output", call_id: "c1", output: "sam  user  160 src" }),
      line("compacted", { message: "summary", replacement_history: [{ type: "message", role: "user", content: [{ type: "input_text", text: "x" }] }] }),
      line("event_msg", { type: "user_message", message: "I keep a list of plants I have killed." }),
      line("turn_context", { cwd: "/home/sam" }),
      "not json, but it mentions the user",
      "",
    ];
    for (const other of unwanted) expect(isCodexLineWanted(other)).toBe(false);
  });
});
