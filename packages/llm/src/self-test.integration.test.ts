import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Kysely } from "kysely";
import { MODEL_OUTPUT_SCHEMAS } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, type Database } from "@meet-first/db";
import { freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { makeLlmClient } from "./client.js";
import { readLedgerWindow } from "./ledger.js";
import { runBootSelfTest, runBootSelfTestOn, selfTestExitCode, selfTestMain } from "./self-test.js";
import { testWorkerEnv } from "./testing/index.js";

const replayEnv = testWorkerEnv("replay");
const noSleep = (): Promise<void> => Promise.resolve();

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
beforeEach(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});
afterEach(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

describe("the boot self-test", () => {
  it("R3.1-T1: the self-test refuses a planted anyOf schema, calls nothing and exits 1", async () => {
    const client = makeLlmClient({ db: workerDb, env: replayEnv, now: () => new Date(), sleep: noSleep, random: () => 0.5 });
    const lines: string[] = [];
    const results = await runBootSelfTestOn(client, { schemas: { planted: z.object({ x: z.union([z.string(), z.number()]) }) }, log: (line) => lines.push(line) });
    expect(results).toEqual([{ name: "planted", ok: false, httpStatus: null, detail: "schema_not_strict" }]);
    expect(selfTestExitCode(results)).toBe(1);
    expect(lines).toEqual(["self-test planted: failed - schema_not_strict"]);
    expect((await readLedgerWindow(workerDb, 600)).callCount).toBe(0);
  });

  it("R3.1-T3: the boot self-test answers all twelve schemas from their fixtures and writes twelve ledger rows", async () => {
    const client = makeLlmClient({ db: workerDb, env: replayEnv, now: () => new Date(), sleep: noSleep, random: () => 0.5 });
    const lines: string[] = [];
    const results = await runBootSelfTest(client, (line) => lines.push(line));
    expect(results).toHaveLength(12);
    expect(results.map((result) => result.name)).toEqual(Object.keys(MODEL_OUTPUT_SCHEMAS));
    for (const result of results) expect(result).toEqual({ name: result.name, ok: true, httpStatus: 200, detail: null });
    expect(selfTestExitCode(results)).toBe(0);
    expect(lines).toHaveLength(12);
    for (const result of results) expect(lines).toContain(`self-test ${result.name}: ok`);
    expect((await readLedgerWindow(workerDb, 600)).callCount).toBe(12);
  });

  it("R10.2-T1: selfTestMain names a missing DATABASE_URL_WORKER and returns 1", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await selfTestMain({ META_API_KEY: "x", META_API_BASE_URL: "https://api.meta.ai/v1", LLM_MODE: "replay" });
    expect(code).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("env_invalid: DATABASE_URL_WORKER");
    spy.mockRestore();
  });

  it("D74-T1: selfTestMain refuses replay in production and returns 1", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await selfTestMain({ DATABASE_URL_WORKER: "postgres://app_worker:test@localhost:5432/meet_first_test", META_API_KEY: "replay-no-key", META_API_BASE_URL: "https://api.meta.ai/v1", LLM_MODE: "replay", NODE_ENV: "production" });
    expect(code).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line.startsWith("llm_mode_replay_in_production:")).toBe(true);
    spy.mockRestore();
  });
});
