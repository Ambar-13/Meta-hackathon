import { describe, expect, it } from "vitest";
import { type z } from "zod";
import { apiEnv, workerEnv } from "./env.js";

const API_ENV = {
  DATABASE_URL_API: "postgres://app_api:change-me@localhost:5432/meet_first",
  APP_ORIGIN: "http://localhost:3000",
};
const WORKER_ENV = {
  DATABASE_URL_WORKER: "postgres://app_worker:change-me@localhost:5432/meet_first",
  META_API_KEY: "replace-me",
  META_API_BASE_URL: "https://api.meta.ai/v1",
};

/** The dotted paths of every issue a failed parse reports. */
function failedPaths(result: { success: boolean; error?: z.ZodError }): string[] {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("environment schemas", () => {
  it("R10.2-T1: apiEnv refuses a missing APP_ORIGIN and names it", () => {
    const withoutOrigin = { DATABASE_URL_API: API_ENV.DATABASE_URL_API };

    const result = apiEnv.safeParse(withoutOrigin);

    expect(failedPaths(result)).toEqual(["APP_ORIGIN"]);
  });

  it("R10.2-T2: workerEnv refuses LLM_MODE outside live, record, replay", () => {
    const mockMode = { ...WORKER_ENV, LLM_MODE: "mock" };

    const result = workerEnv.safeParse(mockMode);

    expect(failedPaths(result)).toEqual(["LLM_MODE"]);
  });

  it("D73-T1: defaults are 40, 130, 40 and info", () => {
    const worker = workerEnv.parse({ ...WORKER_ENV, LLM_MODE: "replay" });
    const api = apiEnv.parse(API_ENV);

    expect(worker.DAILY_USD_CAP).toBe(40);
    expect(worker.TOTAL_USD_CAP).toBe(130);
    expect(worker.MAX_CONCURRENT_MEETINGS).toBe(40);
    expect(worker.LOG_LEVEL).toBe("info");
    expect(api.MAX_CONCURRENT_MEETINGS).toBe(40);
  });
});
