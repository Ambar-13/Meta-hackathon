import { describe, expect, it } from "vitest";
import { CALL_SITE_CONFIG } from "./call-sites.js";
import {
  CHAT_MODEL,
  CHAT_PRICE,
  IMAGE_MODEL,
  IMAGE_PRICE,
  LIMITER,
  VENDOR_LIMITS,
  usdForUsage,
  usdForUsageAt,
} from "./config.js";

describe("config", () => {
  it("R10.8-T1: config names both models, both prices with a source, and the limits", () => {
    expect(typeof CHAT_MODEL).toBe("string");
    expect(typeof IMAGE_MODEL).toBe("string");
    expect(CHAT_MODEL.length).toBeGreaterThan(0);
    expect(IMAGE_MODEL.length).toBeGreaterThan(0);
    expect(typeof CHAT_PRICE.inputUsdPerMillion).toBe("number");
    expect(typeof CHAT_PRICE.cachedInputUsdPerMillion).toBe("number");
    expect(typeof CHAT_PRICE.outputUsdPerMillion).toBe("number");
    expect(typeof IMAGE_PRICE.usdPerImage).toBe("number");
    expect(CHAT_PRICE.source.url.length).toBeGreaterThan(0);
    expect(CHAT_PRICE.source.date.length).toBeGreaterThan(0);
    expect(IMAGE_PRICE.source.url.length).toBeGreaterThan(0);
    expect(IMAGE_PRICE.source.date.length).toBeGreaterThan(0);
    for (const value of Object.values(VENDOR_LIMITS)) expect(typeof value).toBe("number");
    for (const value of Object.values(LIMITER)) expect(typeof value).toBe("number");
  });

  it("D62-T1: usdForUsageAt bills uncached input, cached input, and completion per million tokens, with the reasoning inside completion", () => {
    const price = {
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.5,
      outputUsdPerMillion: 8,
      source: { url: "u", date: "d" },
    };
    const usage = {
      promptTokens: 1_000_000,
      cachedTokens: 200_000,
      completionTokens: 100_000,
      reasoningTokens: 50_000,
    };
    expect(usdForUsageAt(usage, price)).toBe(2.5);
  });

  it("W3-LLM-T1: the speech and card calls measured on the live API cost their prompt and completion tokens at CHAT_PRICE, and reasoning adds nothing", () => {
    // Speech, 27 Oct 2026: 11,048 x 1.25 + 1,294 x 4.25 per million is 0.0193095, rounded to 0.01931.
    const speech = {
      promptTokens: 11_048,
      cachedTokens: 0,
      completionTokens: 1_294,
      reasoningTokens: 1_172,
    };
    // Card, 27 Oct 2026: 6,646 x 1.25 + 2,716 x 4.25 per million is 0.0198505, rounded to 0.019851.
    const card = {
      promptTokens: 6_646,
      cachedTokens: 0,
      completionTokens: 2_716,
      reasoningTokens: 2_417,
    };
    expect(usdForUsage(speech)).toBe(0.01931);
    expect(usdForUsage(card)).toBe(0.019851);
    expect(usdForUsage({ ...speech, reasoningTokens: 0 })).toBe(usdForUsage(speech));
  });

  it("R10.8-T2: usdForUsageAt rounds to 6 decimals", () => {
    const price = {
      inputUsdPerMillion: 3,
      cachedInputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      source: { url: "u", date: "d" },
    };
    const usage = {
      promptTokens: 1_234_567,
      cachedTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
    };
    expect(usdForUsageAt(usage, price)).toBe(3.703701);
  });

  it("R10.8-T3: usdForUsage prices a call at CHAT_PRICE, so 1,000 input and 1,000 output tokens are 0.0055 dollars", () => {
    expect(
      usdForUsage({
        promptTokens: 1000,
        cachedTokens: 0,
        completionTokens: 1000,
        reasoningTokens: 0,
      }),
    ).toBe(0.0055);
  });

  it("W3-LLM-T8: speech waits 45,000 ms for its first token and 120,000 ms for the whole call", () => {
    expect(CALL_SITE_CONFIG.speech.firstTokenMs).toBe(45_000);
    expect(CALL_SITE_CONFIG.speech.timeoutMs).toBe(120_000);
  });
});
