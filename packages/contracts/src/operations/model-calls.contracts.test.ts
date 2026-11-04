import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ContractError } from "./errors.js";
import { MODEL_OUTPUT_SCHEMAS, toStrictJsonSchema } from "./model-calls.js";

type JsonObject = Record<string, unknown>;

const PROMPTS_FOLDER = fileURLToPath(new URL("../../../prompts/", import.meta.url));

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every object schema in a converted schema, with the object itself. */
function objectSchemas(node: unknown, found: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(node)) node.forEach((child) => objectSchemas(child, found));
  if (!isJsonObject(node)) return found;
  if (isJsonObject(node.properties)) found.push(node);
  Object.values(node).forEach((child) => objectSchemas(child, found));
  return found;
}

/** The nesting depth of a converted schema: each nested properties or items level adds one. */
function nestingDepth(node: unknown): number {
  if (!isJsonObject(node)) return 0;
  const childDepths: number[] = [];
  if (isJsonObject(node.properties)) {
    for (const child of Object.values(node.properties)) childDepths.push(1 + nestingDepth(child));
  }
  if ("items" in node) childDepths.push(1 + nestingDepth(node.items));
  return childDepths.length === 0 ? 0 : Math.max(...childDepths);
}

/** The highest vN folder of one prompt, such as "v2". */
function newestVersion(name: string): string {
  const numbers = readdirSync(`${PROMPTS_FOLDER}${name}`)
    .filter((entry) => /^v\d+$/.test(entry))
    .map((entry) => Number(entry.slice(1)));
  return `v${String(Math.max(...numbers))}`;
}

describe("model output schemas", () => {
  it("R3.1-T1: every model output schema converts to strict JSON schema", () => {
    const converted = Object.entries(MODEL_OUTPUT_SCHEMAS).map(([name, schema]) =>
      toStrictJsonSchema(schema, name),
    );

    const offenders = converted.flatMap((result) =>
      objectSchemas(result.schema).filter(
        (object) =>
          object.additionalProperties !== false ||
          JSON.stringify(object.required) !==
            JSON.stringify(Object.keys(object.properties as JsonObject)),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("R3.1-T2: no converted schema contains anyOf, oneOf or allOf", () => {
    const converted = Object.entries(MODEL_OUTPUT_SCHEMAS).map(([name, schema]) =>
      toStrictJsonSchema(schema, name),
    );

    const hits = converted.filter((result) =>
      /"(anyOf|oneOf|allOf)"/.test(JSON.stringify(result.schema)),
    );

    expect(hits.map((result) => result.name)).toEqual([]);
  });

  it("R3.1-T3: no converted schema nests deeper than 10", () => {
    const depths = Object.entries(MODEL_OUTPUT_SCHEMAS).map(([name, schema]) => ({
      name,
      depth: nestingDepth(toStrictJsonSchema(schema, name).schema),
    }));

    expect(depths.filter((entry) => entry.depth > 10)).toEqual([]);
  });

  it("R3.1-T4: a planted anyOf is refused with schema_not_strict", () => {
    const planted = z.object({ x: z.union([z.string(), z.number()]) });

    let caught: unknown;
    try {
      toStrictJsonSchema(planted, "planted");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContractError);
    expect(caught).toMatchObject({ code: "schema_not_strict" });
  });

  it("R3.1-T5: the newest packages/prompts/<name>/vN/schema.json equals the converted schema; older versions keep the schema they shipped with", () => {
    const folders = readdirSync(PROMPTS_FOLDER).filter((name) => name in MODEL_OUTPUT_SCHEMAS);

    const mismatches = folders.filter((name) => {
      const saved: unknown = JSON.parse(
        readFileSync(`${PROMPTS_FOLDER}${name}/${newestVersion(name)}/schema.json`, "utf8"),
      );
      const schema = MODEL_OUTPUT_SCHEMAS[name as keyof typeof MODEL_OUTPUT_SCHEMAS];
      return JSON.stringify(saved) !== JSON.stringify(toStrictJsonSchema(schema, name));
    });

    expect(folders).toHaveLength(12);
    expect(mismatches).toEqual([]);
  });
});
