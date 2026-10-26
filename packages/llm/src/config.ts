// Model names, prices and limits of the Meta Model API, with where each came from and when (R3.9, R10.8).
export const CHAT_MODEL = "muse-spark-1.3"; // ARCHITECTURE.md section 2
export const IMAGE_MODEL = "muse-image-1.0"; // ARCHITECTURE.md section 2
export const DEFAULT_BASE_URL = "https://api.meta.ai/v1"; // D73 comment in IMPLEMENTATION.md 2.6
export const IMAGE_SIZE = "1024x1024"; // D64
// Where a price came from: the page address and the day it was read.
export type PriceSource = { url: string; date: string };
// The price of one chat model, in dollars per million tokens.
export type ModelPrice = { inputUsdPerMillion: number; cachedInputUsdPerMillion: number; outputUsdPerMillion: number; source: PriceSource };
// The price of one image, in dollars.
export type ImagePrice = { usdPerImage: number; source: PriceSource };
// Prices per million tokens, from the planning research of 26 Oct 2026. Ambar checks them against the dashboard [confirm]. With zero prices the caps could never stop spending.
export const CHAT_PRICE: ModelPrice = { inputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.15, outputUsdPerMillion: 4.25, source: { url: "Meta Model API pricing as read by the planning research, 26 Oct 2026", date: "2026-10-26" } }; // [confirm]
// The price of one image call. Images are not costed until a price is known, so this stays at zero [confirm].
export const IMAGE_PRICE: ImagePrice = { usdPerImage: 0, source: { url: "https://dev.meta.ai", date: "2026-10-26" } }; // [confirm] images are not costed until a price is known
// Vendor limits the limiter is sized under (D57, D58, R11.4). 4,000,000 tokens per minute and 150 images per minute are the vendor figures named in the design.
export const VENDOR_LIMITS = { tokensPerMinute: 4_000_000, imageRequestsPerMinute: 150 } as const;
// The limiter's own ceilings, under the vendor's (D58, R11.4).
export const LIMITER = { windowSeconds: 60, maxEstTokens: 3_000_000, maxCalls: 2_000, maxImageCalls: 120 } as const;
// Dollars for one finished call, from usage. Reasoning tokens are billed as output (D62).
export function usdForUsage(usage: { promptTokens: number; cachedTokens: number; completionTokens: number; reasoningTokens: number }): number {
  return usdForUsageAt(usage, CHAT_PRICE);
}
// Dollars for one call at a given price: uncached input, cached input, and output plus reasoning, per million tokens, rounded to 6 decimals (D62, R10.8).
export function usdForUsageAt(usage: { promptTokens: number; cachedTokens: number; completionTokens: number; reasoningTokens: number }, price: ModelPrice): number {
  const dollars = ((usage.promptTokens - usage.cachedTokens) * price.inputUsdPerMillion
    + usage.cachedTokens * price.cachedInputUsdPerMillion
    + (usage.completionTokens + usage.reasoningTokens) * price.outputUsdPerMillion) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
// Dollars for one image call.
export function usdForImage(): number {
  return Math.round(IMAGE_PRICE.usdPerImage * 1_000_000) / 1_000_000;
}
