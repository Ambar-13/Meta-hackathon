import openai from "openai";
import type { z } from "zod";
import { workerEnv, type LlmMode } from "@meet-first/contracts";
import type { LiveCaller, LlmRequest } from "../modes.js";

// One scripted answer of a fake live caller: a status, optional headers and body, a delay, and the
// usage it reports.
export type ScriptedReply = {
  status: number;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  delayMs?: number;
  usage?: {
    promptTokens: number;
    cachedTokens: number;
    completionTokens: number;
    reasoningTokens: number;
  };
};

// The reply a scripted 200 gives when the script gives no body: an empty stop.
const EMPTY_REPLY = {
  choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
};
// The zero usage of a scripted reply that gives none.
const ZERO_USAGE = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 };

// Resolves after the delay, or rejects with the signal's reason as soon as the signal aborts.
function waitOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

// An SDK status error built as the SDK builds one, so decideRetry sees the real class and fields.
function statusError(status: number, headers: Record<string, string>): Error {
  return Object.assign(
    Object.create(openai.APIError.prototype) as InstanceType<typeof openai.APIError>,
    { status, headers, message: `fake status ${String(status)}` },
  );
}

// A fake LiveCaller that answers from a script, in order, and records every request it saw. Tests
// that use it say "fake" in their name.
export function fakeLiveCaller(script: ScriptedReply[]): { live: LiveCaller; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const live: LiveCaller = async (request, signal) => {
    const index = calls.length;
    calls.push(request);
    const reply = script[index];
    if (reply === undefined) throw new Error("fake live caller: script exhausted");
    if (reply.delayMs !== undefined) await waitOrAbort(reply.delayMs, signal);
    if (reply.status !== 200) throw statusError(reply.status, reply.headers ?? {});
    return {
      response: reply.body ?? EMPTY_REPLY,
      usage: reply.usage ?? ZERO_USAGE,
      requestId: `fake-${String(index)}`,
      httpStatus: 200,
    };
  };
  return { live, calls };
}

// The worker's variables for a test in one mode, plus any overrides, so a worker test never names
// the mode variable.
export function testWorkerVariables(
  mode: LlmMode,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    DATABASE_URL_WORKER: "postgres://app_worker:test@localhost:5432/meet_first_test",
    META_API_KEY: "replay-no-key",
    META_API_BASE_URL: "https://api.meta.ai/v1",
    LLM_MODE: mode,
    ...overrides,
  };
}

// The parsed worker env for a test in one mode.
export function testWorkerEnv(
  mode: LlmMode,
  overrides: Record<string, string> = {},
): z.infer<typeof workerEnv> {
  return workerEnv.parse(testWorkerVariables(mode, overrides));
}
