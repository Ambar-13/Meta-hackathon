import openai from "openai";
import { describe, expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import { decideRetry, needsLengthRetry, withTransportRetries } from "./retries.js";

const half = (): number => 0.5;

// Builds an error that passes instanceof openai.APIError and carries status and headers, as the SDK does.
function apiError(
  status: number,
  headers: Record<string, string>,
): InstanceType<typeof openai.APIError> {
  return Object.assign(
    Object.create(openai.APIError.prototype) as InstanceType<typeof openai.APIError>,
    {
      status,
      headers,
      message: `fake status ${String(status)}`,
    },
  );
}

// A fake sleep that returns at once and records each wait.
function fakeSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}

// A fake random source that returns the given values in turn, then the last one again.
function fakeRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

describe("decideRetry", () => {
  it("D59-T1: a 429 with retry-after 2 waits 2,000 ms", () => {
    expect(decideRetry(apiError(429, { "retry-after": "2" }), 0, half)).toEqual({
      shouldRetry: true,
      waitMs: 2000,
      reason: "rate_limited",
    });
  });

  it("D59-T2: retry-after is capped at 10,000 ms", () => {
    expect(decideRetry(apiError(429, { "retry-after": "30" }), 0, half).waitMs).toBe(10000);
  });

  it("D59-T3: a Retry-After header in another letter case is read", () => {
    expect(decideRetry(apiError(429, { "Retry-After": "3" }), 0, half).waitMs).toBe(3000);
  });

  it("D59-T4: an HTTP-date retry-after waits until that time", () => {
    const value = new Date(Date.now() + 4000).toUTCString();
    const waitMs = decideRetry(apiError(429, { "retry-after": value }), 0, half).waitMs;
    expect(waitMs).toBeGreaterThanOrEqual(3000);
    expect(waitMs).toBeLessThanOrEqual(4000);
  });

  it("D59-T5: without a header the wait is 200 plus random times 600 (fake random)", () => {
    expect(decideRetry(apiError(503, {}), 0, half)).toEqual({
      shouldRetry: true,
      waitMs: 500,
      reason: "server_error",
    });
    expect(decideRetry(apiError(503, {}), 0, () => 0).waitMs).toBe(200);
    expect(decideRetry(apiError(503, {}), 0, () => 1).waitMs).toBe(800);
  });

  it("D59-T6: a 400 is never retried", () => {
    expect(decideRetry(apiError(400, {}), 0, half)).toEqual({
      shouldRetry: false,
      waitMs: 0,
      reason: "none",
    });
  });

  it("D59-T7: the third failure is not retried", () => {
    expect(decideRetry(apiError(429, {}), 2, half).shouldRetry).toBe(false);
  });

  it("D59-T8: an error that is not a vendor error is never retried", () => {
    expect(decideRetry(new Error("x"), 0, half).shouldRetry).toBe(false);
  });

  it("R10.3-T2: a first-token timeout is retried once", () => {
    const timeout = new ContractError("model_first_token_timeout", "s", 504);
    expect(decideRetry(timeout, 0, half)).toMatchObject({
      shouldRetry: true,
      reason: "server_error",
    });
    expect(decideRetry(timeout, 1, half).shouldRetry).toBe(false);
  });

  it("R10.3-T3: a call timeout is retried like a 5xx", () => {
    const timeout = new ContractError("model_call_timeout", "s", 504);
    expect(decideRetry(timeout, 0, half).shouldRetry).toBe(true);
    expect(decideRetry(timeout, 1, half).shouldRetry).toBe(true);
    expect(decideRetry(timeout, 2, half).shouldRetry).toBe(false);
  });
});

describe("withTransportRetries", () => {
  it("D59-T9: withTransportRetries runs a 429, a 503 and a success, and sleeps twice (fake sleep, fake random)", async () => {
    const { sleep, waits } = fakeSleep();
    const attempts: number[] = [];
    const errors = [apiError(429, {}), apiError(503, {})];
    const run = (attemptIndex: number): Promise<string> => {
      attempts.push(attemptIndex);
      const failure = errors[attemptIndex];
      if (failure !== undefined) return Promise.reject(failure);
      return Promise.resolve("ok");
    };
    const result = await withTransportRetries(run, { sleep, random: fakeRandom([0.5]) });
    expect(result).toBe("ok");
    expect(attempts).toEqual([0, 1, 2]);
    expect(waits).toEqual([500, 500]);
  });

  it("D59-T10: withTransportRetries throws the third 503 (fake sleep)", async () => {
    const { sleep } = fakeSleep();
    let runs = 0;
    const run = (): Promise<string> => {
      runs += 1;
      return Promise.reject(apiError(503, {}));
    };
    let caught: unknown;
    try {
      await withTransportRetries(run, { sleep, random: half });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 503 });
    expect(runs).toBe(3);
  });
});

describe("needsLengthRetry", () => {
  it("D63-T2: needsLengthRetry is true once for length and cut", () => {
    expect(needsLengthRetry("length", false)).toBe(true);
    expect(needsLengthRetry("cut", false)).toBe(true);
    expect(needsLengthRetry("length", true)).toBe(false);
    expect(needsLengthRetry("stop", false)).toBe(false);
    expect(needsLengthRetry("tool_calls", false)).toBe(false);
  });
});
