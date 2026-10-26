import { describe, expect, it } from "vitest";
import { contentText, parseChatGptMapping, parseChatGptMessages } from "./chatgpt-shapes.js";

describe("ChatGPT shapes", () => {
  it("R1.1-T10: the mapping parser returns null when no conversation has a mapping", () => {
    expect(parseChatGptMapping([{ messages: [] }])).toBeNull();
    expect(parseChatGptMapping("text")).toBeNull();
  });

  it("R1.1-T11: the mapping parser returns an empty list when the mapping holds no user message", () => {
    const root = [
      {
        current_node: "a",
        mapping: { a: { id: "a", message: { author: { role: "assistant" }, content: { parts: ["hi"] } }, parent: null } },
      },
    ];
    expect(parseChatGptMapping(root)).toEqual([]);
  });

  it("R1.1-T12: a loop in the parent links ends the walk", () => {
    const root = [
      {
        current_node: "x",
        mapping: {
          x: { id: "x", message: { author: { role: "user" }, content: { parts: ["loop one"] } }, parent: "y" },
          y: { id: "y", message: { author: { role: "user" }, content: { parts: ["loop two"] } }, parent: "x" },
        },
      },
    ];
    const turns = parseChatGptMapping(root);
    expect(turns?.map((turn) => turn.text)).toEqual(["loop two", "loop one"]);
  });

  it("R1.1-T13: branch nodes follow the walk, by create_time with missing times last, then by key", () => {
    const root = [
      {
        current_node: "u1",
        mapping: {
          u1: { id: "u1", message: { author: { role: "user" }, create_time: 10, content: { parts: ["on path"] } }, parent: null },
          b2: { id: "b2", message: { author: { role: "user" }, create_time: 5, content: { parts: ["branch with time"] } }, parent: null },
          b1: { id: "b1", message: { author: { role: "user" }, content: { parts: ["branch b1"] } }, parent: null },
          b0: { id: "b0", message: { author: { role: "user" }, content: { parts: ["branch b0"] } }, parent: null },
        },
      },
    ];
    const turns = parseChatGptMapping(root) ?? [];
    expect(turns.map((turn) => turn.text)).toEqual(["on path", "branch with time", "branch b0", "branch b1"]);
    expect(turns.map((turn) => turn.exportOrder)).toEqual([0, 1, 2, 3]);
  });

  it("R1.1-T14: contentText reads strings, parts, text and content in that order", () => {
    expect(contentText("plain")).toBe("plain");
    expect(contentText({ parts: ["a", { x: 1 }, "b"] })).toBe("a\n[image]\nb");
    expect(contentText({ text: "t" })).toBe("t");
    expect(contentText({ content: "c" })).toBe("c");
    expect(contentText({ user_profile: "p" })).toBeNull();
    expect(contentText(42)).toBeNull();
  });

  it("R1.1-T15: the 2026 parser reads role and author.role and skips other roles", () => {
    const root = [
      {
        messages: [
          { role: "user", content: "a1" },
          { author: { role: "user" }, content: { parts: ["b1"] } },
          { role: "tool", content: "x" },
        ],
      },
    ];
    const turns = parseChatGptMessages(root) ?? [];
    expect(turns.map((turn) => turn.text)).toEqual(["a1", "b1"]);
    expect(turns.every((turn) => turn.createTime === null)).toBe(true);
  });
});
