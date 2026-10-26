import { sql } from "kysely";
import { ContractError } from "@meet-first/contracts";
import { numberFromPostgres } from "@meet-first/db";
import type { JobContext, JobTask } from "../job-context.js";

// The rows each table lost in one purge, keyed by table name.
type PurgeCounts = Record<string, number>;

// True when Postgres says the function does not exist (SQLSTATE 42883).
function isUndefinedFunction(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "42883";
}

// Runs the purge function of migration 0001 once and reads its (table_name, removed) rows. It runs as the owner, so no person or meeting context is needed.
async function runPurge(context: JobContext): Promise<PurgeCounts> {
  try {
    const result = await sql<{ table_name: string; removed: string }>`SELECT * FROM purge_expired_rows()`.execute(context.db);
    const counts: PurgeCounts = {};
    for (const row of result.rows) counts[row.table_name] = numberFromPostgres(row.removed);
    return counts;
  } catch (error) {
    if (isUndefinedFunction(error)) {
      throw new ContractError("purge_functions_missing", "The purge function purge_expired_rows is not in the database. Run the migrations, then start the worker again.", 500);
    }
    throw error;
  }
}

// The hourly purge (IMPLEMENTATION.md 2.3): expired transfer links (D33), pairs nobody joined within 24 hours (D32) and comics past 30 days whose share page is not published (D64, R11.5).
export const purgeExpiredTask: JobTask<"purge_expired"> = async (payload, context) => {
  const counts = await runPurge(context);
  context.log.info({ transfer_links: counts.transfer_links ?? 0, pairs: counts.pairs ?? 0, comics: counts.comics ?? 0 }, "purge_expired_done");
};
