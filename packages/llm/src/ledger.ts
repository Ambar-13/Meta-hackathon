import { type CallSite, ContractError, type Effort, type LlmMode, type RecordedCall } from "@meet-first/contracts";
import { type Kysely, sql } from "kysely";
import type { Database, LedgerTable } from "@meet-first/db";

// What the ledger row holds before a model call starts (ARCHITECTURE.md 3.23). The row is written first, so a crash still counts.
export type LedgerStart = {
  personId: string | null;
  meetingId: string | null;
  callSite: CallSite;
  model: string;
  effort: Effort;
  estTokens: number;
  llmMode: LlmMode;
};
// What the ledger row gets after the call finishes: its status, usage, cost and request id.
export type LedgerFinish = {
  status: "ok" | "error" | "timeout" | "refused";
  httpStatus?: number;
  requestId?: string;
  usage?: RecordedCall["usage"];
  usd?: number;
};

// The database types these functions take, from @meet-first/db, so the ledger shape lives in one place (as-built item 22).
export type { Database, LedgerTable };

// Writes the ledger row before the call so a crash mid-call still counts against the caps (R3.5, invariant 14). Returns the row id.
// The caller commits this row before it calls the model, so other workers' limiters see it.
export async function startLedgerRow(trx: Kysely<Database>, start: LedgerStart): Promise<string> {
  const row = await trx
    .insertInto("ledger")
    .values({
      person_id: start.personId,
      meeting_id: start.meetingId,
      call_site: start.callSite,
      model: start.model,
      effort: start.effort,
      est_tokens: start.estTokens,
      status: "started",
      llm_mode: start.llmMode,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// The usage columns of a call that sent back no usage, such as a timeout.
const NO_USAGE = { promptTokens: null, cachedTokens: null, completionTokens: null, reasoningTokens: null };

// Fills the row after the call: usage, dollars, status, request id. A row it cannot see is a fault, never a silent skip,
// because a missing finish would leave the spend uncounted.
export async function finishLedgerRow(trx: Kysely<Database>, id: string, finish: LedgerFinish): Promise<void> {
  const usage = finish.usage ?? NO_USAGE;
  const result = await trx
    .updateTable("ledger")
    .set({
      status: finish.status,
      http_status: finish.httpStatus ?? null,
      request_id: finish.requestId ?? null,
      prompt_tokens: usage.promptTokens,
      cached_tokens: usage.cachedTokens,
      completion_tokens: usage.completionTokens,
      reasoning_tokens: usage.reasoningTokens,
      usd: finish.usd ?? null,
      finished_at: sql<Date>`now()`,
    })
    .where("id", "=", id)
    .executeTakeFirst();
  if (result.numUpdatedRows !== 1n) {
    throw new ContractError("ledger_row_missing", `Ledger row ${id} was not found to finish. Finish it in the same context that started it.`, 500);
  }
}

// Token and call totals over the last n seconds across everyone, through the SECURITY DEFINER function (D58, invariant 14).
export async function readLedgerWindow(db: Kysely<Database>, seconds: number): Promise<{ sumEstTokens: number; callCount: number; imageCallCount: number }> {
  const result = await sql<{ sum_est_tokens: string; call_count: string; image_call_count: string }>`SELECT * FROM ledger_window(${seconds})`.execute(db);
  const row = result.rows[0];
  return { sumEstTokens: Number(row?.sum_est_tokens ?? 0), callCount: Number(row?.call_count ?? 0), imageCallCount: Number(row?.image_call_count ?? 0) };
}

// Dollars spent since a time across everyone, for the daily and total caps (D60). Postgres sends numeric as text.
export async function readUsdSince(db: Kysely<Database>, since: Date): Promise<number> {
  const result = await sql<{ usd: string }>`SELECT ledger_usd_since(${since}) AS usd`.execute(db);
  return Number(result.rows[0]?.usd ?? 0);
}

// Tokens one meeting has used so far, for the 1,500,000 stop (D61). Postgres sends bigint as text.
export async function readMeetingTokens(db: Kysely<Database>, meetingId: string): Promise<number> {
  const result = await sql<{ tokens: string }>`SELECT ledger_meeting_tokens(${meetingId}) AS tokens`.execute(db);
  return Number(result.rows[0]?.tokens ?? 0);
}
