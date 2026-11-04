import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractError } from "@meet-first/contracts";
import { z } from "zod";
import { currentVersion, type PromptName } from "./current.js";

// One prompt as the code sends it: the folder name, the version folder, the text of prompt.md, and
// schema.json when the folder has one.
export type Prompt = {
  name: PromptName;
  version: string;
  text: string;
  schema: Record<string, unknown> | null;
};
// The folder that holds every prompt folder: packages/prompts, one level above this file's folder.
export const PROMPTS_ROOT: string = fileURLToPath(new URL("../", import.meta.url));

// The path of one file of a prompt version.
export function promptFilePath(
  name: PromptName,
  version: string,
  file: "prompt.md" | "schema.json",
): string {
  return join(PROMPTS_ROOT, name, version, file);
}

// Reads a schema file and returns its JSON, or refuses it with a sentence that says how to fix it.
function readSchemaJson(schemaPath: string): unknown {
  try {
    return JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;
  } catch {
    throw new ContractError(
      "prompt_schema_invalid",
      `The schema file at ${schemaPath} is not a JSON object. Regenerate it from contracts.`,
      500,
    );
  }
}

// The schema of one prompt version, or null when the folder has no schema.json.
function readSchema(schemaPath: string): Record<string, unknown> | null {
  if (!existsSync(schemaPath)) return null;
  const parsed = z.record(z.string(), z.unknown()).safeParse(readSchemaJson(schemaPath));
  if (!parsed.success) {
    throw new ContractError(
      "prompt_schema_invalid",
      `The schema file at ${schemaPath} is not a JSON object. Regenerate it from contracts.`,
      500,
    );
  }
  return parsed.data;
}

// Reads the current version of one prompt at call time, so a version change in current.ts reaches
// the next call.
export function readPrompt(name: PromptName): Prompt {
  const version = currentVersion(name);
  const mdPath = promptFilePath(name, version, "prompt.md");
  if (!existsSync(mdPath)) {
    throw new ContractError(
      "prompt_missing",
      `No prompt file at ${mdPath}. Add the file, or point current.ts at a version that has one.`,
      500,
    );
  }
  const text = readFileSync(mdPath, "utf8").trimEnd();
  const schema = readSchema(promptFilePath(name, version, "schema.json"));
  return { name, version, text, schema };
}
