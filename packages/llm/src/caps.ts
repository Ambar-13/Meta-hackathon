import type { z } from "zod";
import { ContractError, workerEnv, type CallSite } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { Kysely } from "kysely";
import { readUsdSince } from "./ledger.js";

// The refusal when a dollar cap is reached, with the copy the screen shows.
export class CapReached extends ContractError {}
// The copy for the daily cap, by kind of call.
export const DAILY_CAP_COPY = { card: "card generation paused for today", meeting: "meetings are paused for today", other: "model calls are paused for today" } as const;
// The copy for the total cap.
export const TOTAL_CAP_COPY = "the model budget for this event is used up";

// Midnight UTC of the given instant; the daily cap resets there (the zone is not in the inputs).
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// The refusal copy for one call site when the daily cap is reached.
export function copyFor(callSite: CallSite): string {
  if (callSite === "card" || callSite === "scrub_names") return DAILY_CAP_COPY.card;
  const meetingSites: CallSite[] = ["speech", "receipts", "question_check", "brief", "brief_support_judge"];
  return meetingSites.includes(callSite) ? DAILY_CAP_COPY.meeting : DAILY_CAP_COPY.other;
}

// The two cap settings of the worker env.
type CapSettings = Pick<z.infer<typeof workerEnv>, "DAILY_USD_CAP" | "TOTAL_USD_CAP">;
// Throws CapReached when today's spend reaches DAILY_USD_CAP or all-time spend reaches TOTAL_USD_CAP. The total is checked first.
export async function assertUnderCaps(db: Kysely<Database>, env: CapSettings, args: { callSite: CallSite; now: () => Date }): Promise<void> {
  const total = await readUsdSince(db, new Date(0));
  if (total >= env.TOTAL_USD_CAP) throw new CapReached("total_cap_reached", TOTAL_CAP_COPY, 429);
  const today = await readUsdSince(db, startOfUtcDay(args.now()));
  if (today >= env.DAILY_USD_CAP) throw new CapReached("daily_cap_reached", copyFor(args.callSite), 429);
}
