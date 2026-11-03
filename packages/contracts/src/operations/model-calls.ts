import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CardBuildOutput } from "../cards/card.js";
import { QuizJudgeOutput, QuizPersonaAnswerOutput } from "../cards/quiz.js";
import { BriefOutput, BriefSupportJudgeOutput } from "../briefs/brief.js";
import { ComicPanelsOutput } from "../briefs/comic.js";
import { PersonaAnswerOutput } from "../directory/asks.js";
import { ReceiptsOutput } from "../meetings/claims.js";
import { QuestionCheckOutput } from "../meetings/meeting.js";
import { OrchestratorPlanOutput } from "../social/orchestrator.js";
import { NamesPassOutput } from "../sources/scrub-categories.js";
import { IsoTime } from "../primitives.js";
import { ContractError } from "./errors.js";

// The call sites that reach the model. The ledger CHECK in 0001, widened in 0006, lists the same names.
export const CALL_SITES = [
  "scrub_names", "question_check", "card", "quiz_answer", "quiz_judge", "speech", "receipts", "brief",
  "brief_support_judge", "comic_panels", "comic_image", "self_test", "persona_answer", "ask_support_judge", "orchestrator",
] as const;
// One call site, checked against the list above.
export const CallSite = z.enum(CALL_SITES);
// The type of CallSite, read from the schema above.
export type CallSite = z.infer<typeof CallSite>;
// How hard the model thinks on one call: minimal, low or medium.
export const Effort = z.enum(["minimal", "low", "medium"]);
// The type of Effort, read from the schema above.
export type Effort = z.infer<typeof Effort>;
// One model call as it is stored in a fixture: the request, the reply and the usage.
// request is { callSite, promptVersion, body } as sent; requestHash is the hash of request.body alone.
// recordedAt is null on a hand-written fixture. handWritten is true on fixtures written by hand.
export const RecordedCall = z.object({
  callSite: CallSite,
  promptVersion: z.string(),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  request: z.object({ callSite: CallSite, promptVersion: z.string(), body: z.record(z.unknown()) }),
  response: z.record(z.unknown()),
  usage: z.object({
    promptTokens: z.number().int(),
    cachedTokens: z.number().int(),
    completionTokens: z.number().int(),
    reasoningTokens: z.number().int(),
  }),
  recordedAt: IsoTime.nullable(),
  handWritten: z.boolean().optional(),
});
// The type of RecordedCall, read from the schema above.
export type RecordedCall = z.infer<typeof RecordedCall>;
// Deepest nesting the Meta strict mode accepts, counted in container levels.
const MAX_SCHEMA_NESTING = 10;
// Keys the strict mode rejects. The zod schema still enforces them after parsing.
const DROPPED_KEYS = new Set(["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "format"]);
// Keys that make a schema non-strict. Their presence is refused.
const COMBINATOR_KEYS = ["anyOf", "oneOf", "allOf"];
type JsonObject = Record<string, unknown>;

// Whether a value is a JSON object, not an array or null.
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Copies a schema, drops the keys strict mode rejects, and makes every object strict with every property required.
function makeStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(makeStrict);
  if (!isJsonObject(node)) return node;
  const copy: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (!DROPPED_KEYS.has(key)) copy[key] = makeStrict(value);
  }
  if (isJsonObject(copy.properties)) {
    copy.additionalProperties = false;
    copy.required = Object.keys(copy.properties);
  }
  return copy;
}

// Whether any anyOf, oneOf or allOf appears anywhere in the schema.
function hasCombinator(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasCombinator);
  if (!isJsonObject(node)) return false;
  return Object.entries(node).some(([key, value]) => COMBINATOR_KEYS.includes(key) || hasCombinator(value));
}

// The sub-schemas one level down: property values and array items.
function childSchemas(node: JsonObject): JsonObject[] {
  const children: JsonObject[] = [];
  if (isJsonObject(node.properties)) children.push(...Object.values(node.properties).filter(isJsonObject));
  if (isJsonObject(node.items)) children.push(node.items);
  return children;
}

// The most container levels nested below a schema. A container is an object or array schema that has children.
function nestingDepth(node: JsonObject): number {
  return childSchemas(node)
    .filter((child) => childSchemas(child).length > 0)
    .reduce((deepest, child) => Math.max(deepest, 1 + nestingDepth(child)), 0);
}

// Converts a zod object schema to the strict JSON schema the Meta API accepts.
// Refuses any anyOf, oneOf or allOf, and any schema nested deeper than 10 levels.
export function toStrictJsonSchema(
  schema: z.ZodType<unknown, z.ZodTypeDef, unknown>,
  name: string,
): { name: string; strict: true; schema: Record<string, unknown> } {
  const converted: unknown = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" });
  const strict = makeStrict(converted);
  if (!isJsonObject(strict) || hasCombinator(strict) || nestingDepth(strict) > MAX_SCHEMA_NESTING) {
    throw new ContractError(
      "schema_not_strict",
      `The schema for ${name} uses anyOf or nests deeper than 10 levels. Flatten it before it reaches the model.`,
    );
  }
  return { name, strict: true, schema: strict };
}

// Every model output schema, by prompt folder name, so the boot self-test and the contracts test read one list.
export const MODEL_OUTPUT_SCHEMAS = {
  dossier: CardBuildOutput,
  "scrub-names": NamesPassOutput,
  "question-check": QuestionCheckOutput,
  "quiz-persona-answer": QuizPersonaAnswerOutput,
  "quiz-judge": QuizJudgeOutput,
  "meeting-receipts": ReceiptsOutput,
  brief: BriefOutput,
  "brief-support-judge": BriefSupportJudgeOutput,
  "comic-panels": ComicPanelsOutput,
  "persona-answer": PersonaAnswerOutput,
  orchestrator: OrchestratorPlanOutput,
} as const;
