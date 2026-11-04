import { describe, expect, it } from "vitest";
import { parseClaudeChatMessages } from "./claude-shapes.js";

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

describe("Claude shape", () => {
  it("R1.1-T16: an empty text falls back to the text entries of content, joined by a line break", () => {
    const root = [
      {
        chat_messages: [
          {
            sender: "human",
            text: "",
            content: [
              { type: "text", text: "line one" },
              { type: "tool_use", text: "ignored" },
              { type: "text", text: "line two" },
            ],
          },
        ],
      },
    ];
    const turns = parseClaudeChatMessages(root) ?? [];
    expect(turns.map((turn) => turn.text)).toEqual(["line one\nline two"]);
  });

  it("R1.1-T17: createTime is in seconds", () => {
    const dated = parseClaudeChatMessages([
      { chat_messages: [{ sender: "human", text: "a", created_at: "2025-03-01T09:00:00Z" }] },
    ]);
    const undated = parseClaudeChatMessages([
      { chat_messages: [{ sender: "human", text: "b", created_at: "not a date" }] },
    ]);
    expect(itemAt(dated ?? [], 0).createTime).toBe(1740819600);
    expect(itemAt(undated ?? [], 0).createTime).toBeNull();
  });

  it("R1.1-T18: one conversation object is read like a one-element array, and no chat_messages gives null", () => {
    expect(parseClaudeChatMessages({ chat_messages: [{ sender: "human", text: "solo" }] })).toEqual(
      [{ text: "solo", exportOrder: 0, createTime: null }],
    );
    expect(parseClaudeChatMessages([{ messages: [] }])).toBeNull();
  });

  it("R1.1-T19: an assistant-only conversation gives an empty list", () => {
    expect(
      parseClaudeChatMessages([{ chat_messages: [{ sender: "assistant", text: "x" }] }]),
    ).toEqual([]);
  });
});
