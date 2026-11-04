import { z } from "zod";
import { ContractError, type RecordedCall } from "@meet-first/contracts";
import { type ToolCall } from "./chat-request.js";
import { REPLAY_STREAM_SLICE_CHARS, REPLAY_STREAM_SLICE_MS } from "./modes.js";

// What one streamed reply came to: its text, its tool calls, why it stopped, its usage and when its
// first token came.
export type StreamOutcome = {
  text: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "length" | "tool_calls" | "cut";
  usage: RecordedCall["usage"] | null;
  firstTokenAt: Date | null;
};
// The hooks a stream calls as it is read: one per piece of text, one at the first token, and the
// clock.
export type StreamHooks = {
  onDelta: (text: string) => Promise<void>;
  onFirstToken: () => Promise<void>;
  now: () => Date;
};

// One tool-call fragment of a stream chunk. Fragments of one call share an index.
const ToolFragment = z.object({
  index: z.number().int().min(0),
  id: z.string().optional(),
  function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
});
// One stream chunk, read with this layout. Anything else in the chunk is ignored.
const StreamChunk = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            tool_calls: z.array(ToolFragment).optional(),
          })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z.unknown().optional(),
});
type StreamChunkValue = z.infer<typeof StreamChunk>;
type ToolFragmentValue = z.infer<typeof ToolFragment>;
// The vendor usage object in the openai-compatible shape. Its field names are unverified on Meta.
const VendorUsage = z
  .object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    prompt_tokens_details: z
      .object({ cached_tokens: z.number().int().min(0).optional() })
      .nullable()
      .optional(),
    completion_tokens_details: z
      .object({ reasoning_tokens: z.number().int().min(0).optional() })
      .nullable()
      .optional(),
  })
  .passthrough();

// One tool call in the recorded layout: an id, the type, and a function with its complete
// arguments.
const ReplayToolCall = z
  .object({
    id: z.string().min(1),
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1), arguments: z.string() }).strict(),
  })
  .strict();
// The one choice of a recorded streamed reply.
const ReplayChoice = z
  .object({
    index: z.literal(0),
    message: z
      .object({
        role: z.literal("assistant"),
        content: z.string().nullable(),
        tool_calls: z.array(ReplayToolCall).min(1).optional(),
      })
      .strict(),
    finish_reason: z.enum(["stop", "length", "tool_calls"]).nullable(),
  })
  .strict();
// The recorded layout of one reply, with exactly one choice.
export type ReplayReply = { choices: [z.infer<typeof ReplayChoice>] };
// The fixture response of a streamed reply, checked before replay reads it.
export const ReplayResponse = z
  .object({ choices: z.tuple([ReplayChoice]) })
  .strict()
  .refine(
    (reply) =>
      (reply.choices[0].finish_reason === "tool_calls") ===
      (reply.choices[0].message.tool_calls !== undefined),
    {
      message: "tool_calls is present exactly when finish_reason is tool_calls",
    },
  );

// One tool-call slot as the stream fills it: the id, the name and the arguments joined from its
// fragments.
type ToolSlot = { id: string | undefined; name: string; arguments: string };
// The state of one read: the text so far, the last finish reason, the usage, the first-token time
// and the call slots.
type ReadState = {
  text: string;
  finish: string | undefined;
  usage: RecordedCall["usage"] | null;
  firstTokenAt: Date | null;
  slots: Map<number, ToolSlot>;
};

// Calls the first-token hook once, the first time any text or tool call arrives, and stamps the
// time.
async function markFirstToken(state: ReadState, hooks: StreamHooks): Promise<void> {
  if (state.firstTokenAt !== null) return;
  state.firstTokenAt = hooks.now();
  await hooks.onFirstToken();
}

// Adds one tool-call fragment to its slot, joining the parts by index.
function addFragment(state: ReadState, fragment: ToolFragmentValue): void {
  const slot = state.slots.get(fragment.index) ?? { id: undefined, name: "", arguments: "" };
  if (fragment.id !== undefined) slot.id = fragment.id;
  slot.name += fragment.function?.name ?? "";
  slot.arguments += fragment.function?.arguments ?? "";
  state.slots.set(fragment.index, slot);
}

// Reads the choice of one chunk: its text goes to the delta hook, its fragments to their slots, its
// finish reason is kept.
async function takeChoice(
  state: ReadState,
  choice: NonNullable<NonNullable<StreamChunkValue["choices"]>[number]>,
  hooks: StreamHooks,
): Promise<void> {
  const content = choice.delta?.content;
  if (typeof content === "string" && content !== "") {
    await markFirstToken(state, hooks);
    state.text += content;
    await hooks.onDelta(content);
  }
  for (const fragment of choice.delta?.tool_calls ?? []) {
    await markFirstToken(state, hooks);
    addFragment(state, fragment);
  }
  if (typeof choice.finish_reason === "string") state.finish = choice.finish_reason;
}

// Reads one parsed chunk: its usage when it has one, then its first choice when it has one.
async function takeChunk(
  state: ReadState,
  chunk: StreamChunkValue,
  hooks: StreamHooks,
): Promise<void> {
  if (chunk.usage !== null && chunk.usage !== undefined) state.usage = usageFromVendor(chunk.usage);
  const choice = chunk.choices?.[0];
  if (choice !== undefined) await takeChoice(state, choice, hooks);
}

// Maps the kept finish reason to the outcome's reason. A stream that ended with none was cut;
// content_filter maps to stop.
function outcomeReason(finish: string | undefined): StreamOutcome["finishReason"] {
  if (finish === undefined) return "cut";
  if (finish === "length" || finish === "tool_calls") return finish;
  return "stop";
}

// The tool calls in index order, only when the round ended in calls, so fragments of a cut call are
// dropped.
function completedCalls(state: ReadState, reason: StreamOutcome["finishReason"]): ToolCall[] {
  if (reason !== "tool_calls") return [];
  return [...state.slots.entries()]
    .sort(([left], [right]) => left - right)
    .map(
      ([index, slot]): ToolCall => ({
        id: slot.id ?? `call_${String(index + 1)}`,
        type: "function",
        function: { name: slot.name, arguments: slot.arguments },
      }),
    );
}

// Reads an SDK stream to the end. Tool call argument fragments are joined by index and only parsed
// by the caller after finish_reason tool_calls.
export async function readChatStream(
  stream: AsyncIterable<unknown>,
  hooks: StreamHooks,
  signal: AbortSignal,
): Promise<StreamOutcome> {
  const state: ReadState = {
    text: "",
    finish: undefined,
    usage: null,
    firstTokenAt: null,
    slots: new Map(),
  };
  for await (const raw of stream) {
    if (signal.aborted) throw signal.reason;
    const parsed = StreamChunk.safeParse(raw);
    if (!parsed.success) {
      throw new ContractError(
        "stream_chunk_invalid",
        "The model stream sent a chunk this client cannot read. Check the SDK version against the vendor page.",
      );
    }
    await takeChunk(state, parsed.data, hooks);
  }
  const reason = outcomeReason(state.finish);
  return {
    text: state.text,
    toolCalls: completedCalls(state, reason),
    finishReason: reason,
    usage: state.usage,
    firstTokenAt: state.firstTokenAt,
  };
}

// Sends the text in slices of REPLAY_STREAM_SLICE_CHARS code points, a fixed pause apart.
async function sendSlices(text: string, hooks: StreamHooks): Promise<void> {
  const points = Array.from(text);
  const pieces: string[] = [];
  for (let start = 0; start < points.length; start += REPLAY_STREAM_SLICE_CHARS) {
    pieces.push(points.slice(start, start + REPLAY_STREAM_SLICE_CHARS).join(""));
  }
  for (const [index, piece] of pieces.entries()) {
    if (index > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, REPLAY_STREAM_SLICE_MS));
    await hooks.onDelta(piece);
  }
}

// Turns a recorded streamed reply into the same deltas a live stream would send, 20 characters
// every 10 ms, so replay runs the delta path.
export async function replayAsStream(
  response: Record<string, unknown>,
  hooks: StreamHooks,
): Promise<StreamOutcome> {
  const parsed = ReplayResponse.safeParse(response);
  if (!parsed.success) {
    throw new ContractError(
      "replay_response_invalid",
      "A recorded stream reply is not in the stream layout. Rewrite the fixture in that layout.",
      500,
    );
  }
  const choice = parsed.data.choices[0];
  const text = choice.message.content ?? "";
  let firstTokenAt: Date | null = null;
  if (text !== "" || choice.message.tool_calls !== undefined) {
    firstTokenAt = hooks.now();
    await hooks.onFirstToken();
  }
  if (text !== "") await sendSlices(text, hooks);
  return {
    text,
    toolCalls: choice.message.tool_calls ?? [],
    finishReason: choice.finish_reason ?? "cut",
    usage: null,
    firstTokenAt,
  };
}

// The recorded layout of a finished live stream, for record mode and for the live reply.
export function replyLayoutFrom(outcome: StreamOutcome): ReplayReply {
  const toolMessage =
    outcome.finishReason === "tool_calls" ? { tool_calls: outcome.toolCalls } : {};
  return {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: outcome.text === "" && outcome.toolCalls.length > 0 ? null : outcome.text,
          ...toolMessage,
        },
        finish_reason: outcome.finishReason === "cut" ? null : outcome.finishReason,
      },
    ],
  };
}

// Vendor usage in the openai-compatible shape, as RecordedCall usage; null when the reply carried
// none.
export function usageFromVendor(raw: unknown): RecordedCall["usage"] | null {
  const parsed = VendorUsage.safeParse(raw);
  if (!parsed.success) return null;
  const usage = parsed.data;
  return {
    promptTokens: usage.prompt_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: usage.completion_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}
