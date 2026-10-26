import type openai from "openai";
import { describe, expect, it } from "vitest";
import { makeLiveCaller, makeSdk, worstCaseUsage } from "./client.js";

describe("the SDK and the default live caller", () => {
  it("R10.1-T1: the SDK is built with maxRetries 0", () => {
    expect(makeSdk({ META_API_KEY: "test-key", META_API_BASE_URL: "https://api.meta.ai/v1" }).maxRetries).toBe(0);
  });

  it("D22-T2: the default live caller passes the call site's timeout and the attempt's signal (fake SDK)", async () => {
    const seen: Array<{ options: unknown }> = [];
    const fakeSdk = {
      chat: {
        completions: {
          create: (requestBody: unknown, options: unknown) => {
            seen.push({ options });
            return Promise.resolve({
              id: "chatcmpl-1",
              choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 2 },
            });
          },
        },
      },
    } as unknown as openai;
    const controller = new AbortController();
    const reply = await makeLiveCaller(fakeSdk)({ callSite: "card", promptVersion: "v1", body: { model: "muse-spark-1.3", messages: [] } }, controller.signal);
    const options = seen[0]?.options as { timeout: number; signal: AbortSignal };
    expect(options.timeout).toBe(240000);
    expect(options.signal).toBe(controller.signal);
    expect(reply.requestId).toBe("chatcmpl-1");
    expect(reply.httpStatus).toBe(200);
    expect(reply.usage).toEqual({ promptTokens: 10, cachedTokens: 0, completionTokens: 2, reasoningTokens: 0 });
  });

  it("R10.8-T5: a live reply without usage is priced at the worst case (fake SDK)", () => {
    const body = { model: "muse-spark-1.3", messages: [{ role: "user", content: "x".repeat(133) }], max_tokens: 500 };
    expect(worstCaseUsage(body)).toEqual({ promptTokens: 100, cachedTokens: 0, completionTokens: 500, reasoningTokens: 0 });
  });
});
