import openai from "openai";
import { z } from "zod";
import { ContractError } from "@meet-first/contracts";

// How many times one call is retried after a 429, a 5xx or a silence (D59).
export const TRANSPORT_RETRIES = 2;
// The random wait between two retries when the server gave no retry-after, in milliseconds (D59).
export const RETRY_JITTER_MS = { min: 200, max: 800 } as const;
// The longest retry-after the client will honour, in milliseconds (D59).
export const RETRY_AFTER_CAP_MS = 10_000;
// One attempt at a call, by its zero-based index.
export type Attempt<T> = () => Promise<T>;
// Whether a failed call may be tried again, how long to wait first, and why it failed.
export type RetryDecision = { shouldRetry: boolean; waitMs: number; reason: "rate_limited" | "server_error" | "none" };
// The fields of a vendor error the retry rule reads: its HTTP status and its headers (the openai README names both).
const VendorError = z
  .object({
    status: z.number().int(),
    headers: z.record(z.string(), z.string().nullable().optional()).optional(),
  })
  .passthrough();

// A decision that gives up on the call.
const NO_RETRY: RetryDecision = { shouldRetry: false, waitMs: 0, reason: "none" };

// The random jitter wait for one retry, between the two bounds of RETRY_JITTER_MS.
function jitterWait(random: () => number): number {
  return Math.round(RETRY_JITTER_MS.min + random() * (RETRY_JITTER_MS.max - RETRY_JITTER_MS.min));
}

// The retry-after header, read without regard to letter case; seconds when digits only, else an HTTP date (D59).
function retryAfterMs(headers: Record<string, string | null | undefined> | undefined): number | null {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "retry-after");
  const value = entry?.[1]?.trim();
  if (value === undefined || value === "") return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, RETRY_AFTER_CAP_MS);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(0, parsed - Date.now()), RETRY_AFTER_CAP_MS);
}

// The decision for a vendor error: 429 is rate limited, 500 to 599 is a server error, anything else is not retried (D59).
function decideVendorError(error: unknown, attemptIndex: number, random: () => number): RetryDecision {
  if (!(error instanceof openai.APIError)) return NO_RETRY;
  const parsed = VendorError.safeParse(error);
  if (!parsed.success) return NO_RETRY;
  const status = parsed.data.status;
  const waitMs = retryAfterMs(parsed.data.headers) ?? jitterWait(random);
  if (status === 429) return { shouldRetry: true, waitMs, reason: "rate_limited" };
  if (status >= 500 && status <= 599) return { shouldRetry: true, waitMs, reason: "server_error" };
  return NO_RETRY;
}

// Decides whether one failed call may be retried and how long to wait: retry-after wins up to 10 s, else jitter 200 to 800 ms (D59).
// Checks run in order and stop at the first match: the attempt limit, the first-token timeout, the call timeout, a vendor error, anything else.
export function decideRetry(error: unknown, attemptIndex: number, random: () => number): RetryDecision {
  if (attemptIndex >= TRANSPORT_RETRIES) return NO_RETRY;
  if (error instanceof ContractError && error.code === "model_first_token_timeout") {
    // Speech is the only streaming call site and retries its first-token timeout once (R10.3).
    if (attemptIndex !== 0) return NO_RETRY;
    return { shouldRetry: true, waitMs: jitterWait(random), reason: "server_error" };
  }
  if (error instanceof ContractError && error.code === "model_call_timeout") {
    return { shouldRetry: true, waitMs: jitterWait(random), reason: "server_error" };
  }
  return decideVendorError(error, attemptIndex, random);
}

// Runs the call with up to two retries on 429 and 5xx. Each attempt is a separate call, and the client writes one ledger row per attempt (R3.5).
export async function withTransportRetries<T>(
  run: (attemptIndex: number) => Promise<T>,
  hooks: { sleep: (ms: number) => Promise<void>; random: () => number },
): Promise<T> {
  for (let attemptIndex = 0; attemptIndex <= TRANSPORT_RETRIES; attemptIndex += 1) {
    try {
      return await run(attemptIndex);
    } catch (error) {
      const decision = decideRetry(error, attemptIndex, hooks.random);
      if (!decision.shouldRetry) throw error;
      await hooks.sleep(decision.waitMs);
    }
  }
  throw new ContractError("retries_exhausted", "The model call failed after every retry. The job fails closed and the sweeper or the next attempt picks it up.", 503);
}

// True when a finished reply must be discarded and retried once at effort minimal and max_tokens of at least 8,000 (D63).
export function needsLengthRetry(finishReason: string, alreadyRetried: boolean): boolean {
  return (finishReason === "length" || finishReason === "cut") && !alreadyRetried;
}
