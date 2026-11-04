import openai from "openai";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ContractError,
  MODEL_OUTPUT_SCHEMAS,
  toStrictJsonSchema,
  workerEnv,
} from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE } from "@meet-first/db";
import { makeLlmClient, type LlmClient } from "./client.js";
import { assertModeAllowed } from "./modes.js";

// One zod schema of a model output, as the strict converter reads it.
type SchemaOf = z.ZodType<unknown, z.ZodTypeDef, unknown>;
// The outcome of one schema in the boot self-test: its name, whether the vendor accepted it, its
// HTTP status and what went wrong.
export type SelfTestResult = {
  name: string;
  ok: boolean;
  httpStatus: number | null;
  detail: string | null;
};

// The failed result of one schema, from the code or the vendor error it raised.
function failureOf(name: string, error: unknown): SelfTestResult {
  if (error instanceof openai.APIError)
    return { name, ok: false, httpStatus: error.status ?? null, detail: error.message };
  if (error instanceof ContractError)
    return { name, ok: false, httpStatus: null, detail: error.code };
  return { name, ok: false, httpStatus: null, detail: String(error) };
}

// Sends one schema in a one-token strict call and reports the result; a schema that fails to
// convert is reported with no call.
async function checkSchema(
  client: LlmClient,
  name: string,
  schema: SchemaOf,
): Promise<SelfTestResult> {
  let strict: ReturnType<typeof toStrictJsonSchema>;
  try {
    strict = toStrictJsonSchema(schema, name);
  } catch (error) {
    return failureOf(name, error);
  }
  try {
    await client.complete({
      callSite: "self_test",
      promptVersion: "v1",
      messages: [{ role: "user", content: "ok" }],
      schema: strict,
      ledger: { personId: null, meetingId: null },
    });
    return { name, ok: true, httpStatus: 200, detail: null };
  } catch (error) {
    return failureOf(name, error);
  }
}

// The same run over any map of schemas, so a test can plant a bad one. Every schema is tried, even
// after a failure.
export async function runBootSelfTestOn(
  client: LlmClient,
  options: { schemas: Record<string, SchemaOf>; log: (line: string) => void },
): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  for (const [name, schema] of Object.entries(options.schemas)) {
    const result = await checkSchema(client, name, schema);
    options.log(
      result.ok
        ? `self-test ${name}: ok`
        : `self-test ${name}: failed ${String(result.httpStatus ?? "-")} ${result.detail ?? ""}`,
    );
    results.push(result);
  }
  return results;
}

// Sends each model output schema in a one-token strict call and reports per schema. Any 400 is a
// failure.
export function runBootSelfTest(
  client: LlmClient,
  log: (line: string) => void,
): Promise<SelfTestResult[]> {
  return runBootSelfTestOn(client, { schemas: MODEL_OUTPUT_SCHEMAS, log });
}

// 1 when any schema failed, else 0: the process exit code of the self-test.
export function selfTestExitCode(results: readonly SelfTestResult[]): number {
  return results.some((result) => !result.ok) ? 1 : 0;
}

// Process entry for `pnpm --filter @meet-first/worker self-test`: exits 1 when any schema failed or
// the mode is refused.
export async function selfTestMain(env: NodeJS.ProcessEnv): Promise<number> {
  const parsed = workerEnv.safeParse(env);
  if (!parsed.success) {
    console.log(
      `env_invalid: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
    return 1;
  }
  try {
    assertModeAllowed(parsed.data.LLM_MODE, env.NODE_ENV);
  } catch (error) {
    if (error instanceof ContractError) {
      console.log(`${error.code}: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const db = makeDatabase(parsed.data.DATABASE_URL_WORKER, POOL_SIZE.worker);
  const client = makeLlmClient({
    db,
    env: parsed.data,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
  });
  const results = await runBootSelfTest(client, (line) => {
    console.log(line);
  });
  await db.destroy();
  return selfTestExitCode(results);
}

// Starts the self-test when this file is the process entry; importing it starts nothing.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await selfTestMain(process.env);
}
