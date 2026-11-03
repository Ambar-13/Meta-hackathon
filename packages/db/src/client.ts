import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { ContractError } from "@meet-first/contracts";
import type { Database } from "./types.js";

// Pool sizes per process: the api holds 10, the worker 8, the migrator 2 and the tests 4. The api's LISTEN connection is a separate single client owned by apps/api.
export const POOL_SIZE = { api: 10, worker: 8, migrate: 2, test: 4 } as const;

// Opens a Kysely client on url with poolSize connections. The url decides the role (app_api, app_worker or app_migrate); nothing here changes it.
export function makeDatabase(url: string, poolSize: number): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: url, max: poolSize, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

// Postgres returns bigint and numeric as strings; this turns one such value into a number and refuses anything else.
export function numberFromPostgres(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(value)) return Number(value);
  throw new ContractError("postgres_number_invalid", "A count or sum came back in a shape that is not a number. Check the query.");
}
