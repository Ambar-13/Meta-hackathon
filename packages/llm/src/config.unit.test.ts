import { describe, expect, it } from "vitest";
import { CHAT_MODEL, CHAT_PRICE, IMAGE_MODEL, IMAGE_PRICE, LIMITER, VENDOR_LIMITS, usdForUsage, usdForUsageAt } from "./config.js";

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

  it("D62-T1: usdForUsageAt bills uncached input, cached input, and output plus reasoning per million tokens", () => {
    const price = { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 8, source: { url: "u", date: "d" } };
    const usage = { promptTokens: 1_000_000, cachedTokens: 200_000, completionTokens: 100_000, reasoningTokens: 50_000 };
    expect(usdForUsageAt(usage, price)).toBe(2.9);
  });

  it("R10.8-T2: usdForUsageAt rounds to 6 decimals", () => {
    const price = { inputUsdPerMillion: 3, cachedInputUsdPerMillion: 0, outputUsdPerMillion: 0, source: { url: "u", date: "d" } };
    const usage = { promptTokens: 1_234_567, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 };
    expect(usdForUsageAt(usage, price)).toBe(3.703701);
  });

  it("R10.8-T3: usdForUsage prices a call at CHAT_PRICE, so 1,000 input and 1,000 output tokens are 0.0055 dollars", () => {
    expect(usdForUsage({ promptTokens: 1000, cachedTokens: 0, completionTokens: 1000, reasoningTokens: 0 })).toBe(0.0055);
  });
});
