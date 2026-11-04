import { describe, expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import {
  readChatStream,
  replayAsStream,
  replyLayoutFrom,
  ReplayResponse,
  usageFromVendor,
  type StreamHooks,
} from "./stream-reader.js";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const signal = new AbortController().signal;
const call = {
  id: "call_1",
  type: "function" as const,
  function: { name: "recall", arguments: '{"query":"deadlines"}' },
};

// Makes a hook set that writes each call into the events list, as the test names them.
function recordingHooks(events: string[]): StreamHooks {
  return {
    onDelta: (text: string) => {
      events.push(`delta:${text}`);
      return Promise.resolve();
    },
    onFirstToken: () => {
      events.push("first");
      return Promise.resolve();
    },
    now: () => NOW,
  };
}

// A fake stream: an async generator that yields the chunks it was given, in order.
async function* fakeStream(chunks: readonly unknown[]) {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

// The code of the error a promise rejects with, or an empty string when it resolves.
async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "";
  } catch (error) {
    return error instanceof ContractError ? error.code : "not a contract error";
  }
}

describe("readChatStream", () => {
  it("R10.7-T1: tool call fragments are joined by index and returned after finish_reason tool_calls (fake stream)", async () => {
    const events: string[] = [];
    const chunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "recall", arguments: '{"que' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"deadlines"}' } }] } },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ];
    const outcome = await readChatStream(fakeStream(chunks), recordingHooks(events), signal);
    expect(outcome.toolCalls).toEqual([call]);
    expect(outcome.finishReason).toBe("tool_calls");
    expect(outcome.text).toBe("");
    expect(events).toEqual(["first"]);
  });

  it("R10.7-T2: a stream that ends without a finish reason is cut and drops its partial tool call (fake stream)", async () => {
    const events: string[] = [];
    const chunks = [
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "recall", arguments: '{"q' } },
              ],
            },
          },
        ],
      },
    ];
    const outcome = await readChatStream(fakeStream(chunks), recordingHooks(events), signal);
    expect(outcome.finishReason).toBe("cut");
    expect(outcome.toolCalls).toEqual([]);
    expect(outcome.text).toBe("Hello");
    expect(events).toEqual(["first", "delta:Hel", "delta:lo"]);
  });

  it("R10.3-T1: onFirstToken fires once before the first delta and firstTokenAt is the hook clock's time (fake stream, fake clock)", async () => {
    const events: string[] = [];
    const chunks = [
      { choices: [{ delta: { content: "a" } }] },
      { choices: [{ delta: { content: "b" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ];
    const outcome = await readChatStream(fakeStream(chunks), recordingHooks(events), signal);
    expect(events).toEqual(["first", "delta:a", "delta:b"]);
    expect(outcome.firstTokenAt).toEqual(NOW);
  });

  it("R10.7-T3: a chunk the client cannot read throws stream_chunk_invalid (fake stream)", async () => {
    const code = await codeOf(
      readChatStream(fakeStream([{ choices: "x" }]), recordingHooks([]), signal),
    );
    expect(code).toBe("stream_chunk_invalid");
  });
});

describe("replayAsStream", () => {
  it("R10.5-T1: a replayed empty reply returns empty text and stop and calls no hook", async () => {
    const events: string[] = [];
    const outcome = await replayAsStream(
      {
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      },
      recordingHooks(events),
    );
    expect(outcome).toEqual({
      text: "",
      toolCalls: [],
      finishReason: "stop",
      usage: null,
      firstTokenAt: null,
    });
    expect(events).toEqual([]);
  });

  it("D74-T2: a replayed reply arrives in slices of 20 code points and never splits an emoji", async () => {
    const events: string[] = [];
    const text = "a".repeat(20) + "b".repeat(20) + "c".repeat(5);
    await replayAsStream(
      {
        choices: [
          { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
        ],
      },
      recordingHooks(events),
    );
    expect(events).toEqual([
      "first",
      `delta:${"a".repeat(20)}`,
      `delta:${"b".repeat(20)}`,
      "delta:ccccc",
    ]);

    const emojiEvents: string[] = [];
    const emoji = "🙂".repeat(25);
    await replayAsStream(
      {
        choices: [
          { index: 0, message: { role: "assistant", content: emoji }, finish_reason: "stop" },
        ],
      },
      recordingHooks(emojiEvents),
    );
    const deltas = emojiEvents
      .filter((event) => event.startsWith("delta:"))
      .map((event) => event.slice("delta:".length));
    expect(deltas).toHaveLength(2);
    expect(deltas[0]?.length).toBe(40);
    expect(Array.from(deltas[1] ?? "").length).toBe(5);
  });

  it("R10.7-T4: a replayed null finish reason replays its text and ends cut", async () => {
    const events: string[] = [];
    const outcome = await replayAsStream(
      {
        choices: [
          { index: 0, message: { role: "assistant", content: "partial" }, finish_reason: null },
        ],
      },
      recordingHooks(events),
    );
    expect(events).toEqual(["first", "delta:partial"]);
    expect(outcome.finishReason).toBe("cut");
    expect(outcome.text).toBe("partial");
  });

  it("D74-T3: a replayed tool-only round fires onFirstToken once and returns the calls", async () => {
    const events: string[] = [];
    const outcome = await replayAsStream(
      {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null, tool_calls: [call] },
            finish_reason: "tool_calls",
          },
        ],
      },
      recordingHooks(events),
    );
    expect(events).toEqual(["first"]);
    expect(outcome.toolCalls).toEqual([call]);
    expect(outcome.text).toBe("");
  });

  it("D74-T4: a replayed response outside the layout throws replay_response_invalid", async () => {
    const empty = await codeOf(replayAsStream({ choices: [] }, recordingHooks([])));
    const mismatched = await codeOf(
      replayAsStream(
        {
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: null, tool_calls: [call] },
              finish_reason: "stop",
            },
          ],
        },
        recordingHooks([]),
      ),
    );
    expect(empty).toBe("replay_response_invalid");
    expect(mismatched).toBe("replay_response_invalid");
  });
});

describe("usage and layout", () => {
  it("R10.8-T4: usageFromVendor reads the openai-compatible usage and returns null without one", () => {
    expect(
      usageFromVendor({
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ).toEqual({ promptTokens: 120, cachedTokens: 20, completionTokens: 30, reasoningTokens: 5 });
    expect(usageFromVendor({ prompt_tokens: 1, completion_tokens: 2 })).toEqual({
      promptTokens: 1,
      cachedTokens: 0,
      completionTokens: 2,
      reasoningTokens: 0,
    });
    expect(usageFromVendor(null)).toBeNull();
    expect(usageFromVendor({})).toBeNull();
  });

  it("R10.7-T5: replyLayoutFrom writes a layout that replay reads back", () => {
    const toolLayout = replyLayoutFrom({
      text: "",
      toolCalls: [call],
      finishReason: "tool_calls",
      usage: null,
      firstTokenAt: null,
    });
    const cutLayout = replyLayoutFrom({
      text: "ab",
      toolCalls: [],
      finishReason: "cut",
      usage: null,
      firstTokenAt: null,
    });
    expect(toolLayout.choices[0].message.content).toBeNull();
    expect(toolLayout.choices[0].message.tool_calls).toEqual([call]);
    expect(toolLayout.choices[0].finish_reason).toBe("tool_calls");
    expect(cutLayout.choices[0].message.content).toBe("ab");
    expect(Object.keys(cutLayout.choices[0].message)).not.toContain("tool_calls");
    expect(cutLayout.choices[0].finish_reason).toBeNull();
    expect(ReplayResponse.safeParse(toolLayout).success).toBe(true);
    expect(ReplayResponse.safeParse(cutLayout).success).toBe(true);
  });
});
