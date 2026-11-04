import { z } from "zod";
import { Uuid } from "../primitives.js";
import { toStrictJsonSchema } from "../operations/model-calls.js";

// Most rounds of tool calls one turn may use. The 5th request carries no tools.
export const TOOL_ROUNDS_MAX = 4;
// Turns a recall call returns at most.
export const RECALL_TOP_K = 5;
// Characters of each recalled turn that the model sees.
export const RECALL_SNIPPET_CHARS = 600;
// The tools a persona may call. The meeting runs persona to persona with nobody online, so no tool reaches a person.
export const ToolName = z.enum(["recall", "concede", "hold"]);
export type ToolName = z.infer<typeof ToolName>;
// Arguments of the recall tool: a short query over the speaker's own scrubbed notes.
export const recallArgs = z.object({ query: z.string().min(1).max(200) });
// The type of recallArgs, read from the schema above.
export type RecallArgs = z.infer<typeof recallArgs>;
// What the recall tool returns: up to 5 turns, each cut to 600 characters.
export const recallResult = z.object({
  turns: z
    .array(z.object({ turnId: Uuid, text: z.string().max(RECALL_SNIPPET_CHARS) }))
    .max(RECALL_TOP_K),
});
// The type of recallResult, read from the schema above.
export type RecallResult = z.infer<typeof recallResult>;
// Arguments of the concede tool: the id of the other side's claim and the reason.
export const concedeArgs = z.object({ claimId: Uuid, reason: z.string().min(1).max(300) });
// The type of concedeArgs, read from the schema above.
export type ConcedeArgs = z.infer<typeof concedeArgs>;
// Arguments of the hold tool: the reason the persona keeps its position.
export const holdArgs = z.object({ reason: z.string().min(1).max(300) });
// The type of holdArgs, read from the schema above.
export type HoldArgs = z.infer<typeof holdArgs>;
// What a tool returns when it only records something.
export const recordedResult = z.object({ recorded: z.literal(true) });
// The type of recordedResult, read from the schema above.
export type RecordedResult = z.infer<typeof recordedResult>;
// One tool as the chat completions request expects it. Parameters come from the strict JSON schema of its arguments.
export type ToolDefinition = {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
};
// The tools for one request, or undefined when none may be offered.
// Rounds are 1-based, so round 5 is the first request with no tools.
export function toolsForPhase(
  phase: "open" | "explore" | "decide",
  round: number,
): ToolDefinition[] | undefined {
  if (round >= TOOL_ROUNDS_MAX + 1) return undefined;
  if (phase === "decide") return [buildConcedeTool(), buildHoldTool()];
  return [buildRecallTool()];
}
// The recall tool definition. Its description is fixed by the spec and read by the model.
function buildRecallTool(): ToolDefinition {
  return buildDefinition(
    "recall",
    "Search your own scrubbed notes for up to 5 turns about the query. Quotes from them may be shown to the other person.",
    recallArgs,
  );
}
// The concede tool definition. Its description is fixed by the spec and read by the model.
function buildConcedeTool(): ToolDefinition {
  return buildDefinition(
    "concede",
    "Accept one of the other side's claims by id and say why.",
    concedeArgs,
  );
}
// The hold tool definition. Its description is fixed by the spec and read by the model.
function buildHoldTool(): ToolDefinition {
  return buildDefinition("hold", "Keep your position and say why.", holdArgs);
}
// Builds one tool definition with the strict parameter schema of its arguments.
function buildDefinition(
  name: ToolName,
  description: string,
  args: z.ZodType<unknown, z.ZodTypeDef, unknown>,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: toStrictJsonSchema(args, name).schema,
      strict: true,
    },
  };
}
