// Model names, prices and limits of the Meta Model API, with where each came from and when.
// The model of every text call.
export const CHAT_MODEL = "muse-spark-1.3";
// The model that draws the comic panels.
export const IMAGE_MODEL = "muse-image-1.0";
// The Meta Model API's address when META_API_BASE_URL is not set.
export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
// The size of each comic panel image.
export const IMAGE_SIZE = "1024x1024";
// Where a price came from: the page address and the day it was read.
export type PriceSource = { url: string; date: string };
// The price of one chat model, in dollars per million tokens.
export type ModelPrice = { inputUsdPerMillion: number; cachedInputUsdPerMillion: number; outputUsdPerMillion: number; source: PriceSource };
// The price of one image, in dollars.
export type ImagePrice = { usdPerImage: number; source: PriceSource };
// Prices per million tokens of muse-spark-1.3 in standard mode, read on Meta's pricing page on 27 Oct 2026. With zero prices the caps could never stop spending.
export const CHAT_PRICE: ModelPrice = { inputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.15, outputUsdPerMillion: 4.25, source: { url: "https://dev.meta.ai/docs/pricing-rate-limits", date: "2026-10-27" } };
// The price of one generated image of muse-image-1.0, read on Meta's pricing page on 27 Oct 2026: a flat $0.01, billed only for images returned.
export const IMAGE_PRICE: ImagePrice = { usdPerImage: 0.01, source: { url: "https://dev.meta.ai/docs/pricing-rate-limits", date: "2026-10-27" } };
// Vendor limits the limiter is sized under: muse-spark-1.3 allows 4,000,000 tokens and 3,000 requests a minute, muse-image-1.0 150 requests a
// minute, per team (Meta's pricing page).
export const VENDOR_LIMITS = { tokensPerMinute: 4_000_000, imageRequestsPerMinute: 150 } as const;
// The limiter's own ceilings, under the vendor's.
export const LIMITER = { windowSeconds: 60, maxEstTokens: 3_000_000, maxCalls: 2_000, maxImageCalls: 120 } as const;
// Dollars for one finished call, from usage. Reasoning tokens are billed as output, inside the completion tokens.
export function usdForUsage(usage: { promptTokens: number; cachedTokens: number; completionTokens: number; reasoningTokens: number }): number {
  return usdForUsageAt(usage, CHAT_PRICE);
}
// Dollars for one call at a given price: uncached input, cached input, and completion, per million tokens, rounded to 6 decimals.
// Reasoning is billed as output, but Meta counts it inside completion_tokens, so it is not added again; it stays in the usage and the
// ledger. Measured on the live API on 27 Oct 2026: a speech call reported prompt 11,048, completion 1,294 of which reasoning 1,172, and total
// 12,342, which is prompt plus completion; Meta's schema calls completion_tokens_details "a breakdown of the completion tokens".
export function usdForUsageAt(usage: { promptTokens: number; cachedTokens: number; completionTokens: number; reasoningTokens: number }, price: ModelPrice): number {
  const dollars = ((usage.promptTokens - usage.cachedTokens) * price.inputUsdPerMillion
    + usage.cachedTokens * price.cachedInputUsdPerMillion
    + usage.completionTokens * price.outputUsdPerMillion) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
// Dollars for one image call.
export function usdForImage(): number {
  return Math.round(IMAGE_PRICE.usdPerImage * 1_000_000) / 1_000_000;
}
