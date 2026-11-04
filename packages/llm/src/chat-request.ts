import { z } from "zod";
import {
  ContractError,
  type CallSite,
  type Effort,
  type ToolDefinition,
  type toStrictJsonSchema,
} from "@meet-first/contracts";
import { CALL_SITE_CONFIG } from "./call-sites.js";
import { CHAT_MODEL } from "./config.js";

// One message of a chat completions request, as the worker sends it.
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
// One tool call the model made, with its name and its arguments as a JSON string.
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
// The arguments that build one chat request for one call site.
export type ChatRequestArgs = {
  callSite: CallSite;
  messages: ChatMessage[];
  schema?: ReturnType<typeof toStrictJsonSchema>;
  tools?: ToolDefinition[];
  promptCacheKey?: string;
  stream: boolean;
  override?: { effort?: Effort; maxTokens?: number }; // used by the finish_reason length retry only
};
// The characters per token the pre-call estimate assumes before a source has been calibrated.
export const DEFAULT_CHARS_PER_TOKEN = 1.33;
// The message list and tool definitions, read to count characters for the estimate.
const CountedBody = z
  .object({
    messages: z.array(z.object({ content: z.string().nullable().optional() }).passthrough()),
    tools: z.array(z.unknown()).optional(),
  })
  .passthrough();

// The request body for one call, built from CALL_SITE_CONFIG so effort, max_tokens and temperature cannot drift per caller.
export function buildChatRequest(args: ChatRequestArgs): Record<string, unknown> {
  const config = CALL_SITE_CONFIG[args.callSite];
  const body: Record<string, unknown> = {
    model: CHAT_MODEL,
    messages: args.messages,
    max_tokens: args.override?.maxTokens ?? config.maxTokens,
  };
  if (args.callSite !== "self_test") body.reasoning_effort = args.override?.effort ?? config.effort;
  if (config.temperature === 0) body.temperature = 0;
  if (args.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  addOptionalFields(body, args);
  return body;
}

// Adds the keys that exist only for some calls: tools, the output schema and the cache key.
function addOptionalFields(body: Record<string, unknown>, args: ChatRequestArgs): void {
  if (args.tools !== undefined) body.tools = args.tools;
  if (args.schema !== undefined)
    body.response_format = { type: "json_schema", json_schema: args.schema };
  if (args.promptCacheKey !== undefined) body.prompt_cache_key = args.promptCacheKey;
}

// Characters of every message content plus tool definitions, for the pre-call estimate.
export function requestChars(body: Record<string, unknown>): number {
  const parsed = CountedBody.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(
      "request_body_invalid",
      "A chat request body has no messages array. Build it with buildChatRequest.",
      500,
    );
  }
  const messageChars = parsed.data.messages.reduce(
    (sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0),
    0,
  );
  const toolChars = parsed.data.tools === undefined ? 0 : JSON.stringify(parsed.data.tools).length;
  return messageChars + toolChars;
}

// Tokens estimated before the call: chars divided by charsPerToken, default 1.33 because Tamil is three times English; never below 1.
export function estimateTokens(chars: number, charsPerToken: number | null): number {
  return Math.max(1, Math.ceil(chars / (charsPerToken ?? DEFAULT_CHARS_PER_TOKEN)));
}
