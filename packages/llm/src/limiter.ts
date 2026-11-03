import { ContractError, LIMITER_RETRY_MS, type Enqueue, type JobName, type JobPayload } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { Kysely } from "kysely";
import { LIMITER } from "./config.js";
import { readLedgerWindow } from "./ledger.js";

// The refusal for a call that would overflow the shared token window, with the time the job may try again.
export class LimiterBusy extends ContractError {
  constructor(public readonly retryAtMs: number) {
    super("limiter_busy", "The shared token window is full. The job re-enqueues itself in 5 seconds.", 429);
  }
}

// Reads ledger_window(60) and throws LimiterBusy when the window is at or over any ceiling. The ledger is the only counter.
export async function assertWindowHasRoom(db: Kysely<Database>, kind: "chat" | "image", now: () => Date): Promise<void> {
  const window = await readLedgerWindow(db, LIMITER.windowSeconds);
  const isFull = window.sumEstTokens >= LIMITER.maxEstTokens || window.callCount >= LIMITER.maxCalls || (kind === "image" && window.imageCallCount >= LIMITER.maxImageCalls);
  if (isFull) throw new LimiterBusy(now().getTime() + LIMITER_RETRY_MS);
}

// What a job does on LimiterBusy: re-enqueue the same job at now + 5 s and return.
export async function reenqueueAfterLimiter<N extends JobName>(context: { enqueue: Enqueue; now: () => Date }, name: N, payload: JobPayload<N>): Promise<void> {
  await context.enqueue(name, payload, { runAt: new Date(context.now().getTime() + LIMITER_RETRY_MS) });
}
