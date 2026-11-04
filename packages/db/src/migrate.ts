import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runMigrations as runGraphileMigrations } from "graphile-worker";
import type { Kysely } from "kysely";
import pg from "pg";
import { ContractError, migrateEnv } from "@meet-first/contracts";
import { numberFromPostgres } from "./client.js";
import { describeError } from "./database-errors.js";
import type { Database } from "./types.js";

// The schema version this build was written for; the worker refuses to start on any other. Raise it in the same change as each new migration file.
export const SCHEMA_VERSION = 16;

// The advisory lock key every migrator takes first, so two migrators never run at once.
export const MIGRATION_LOCK_KEY = 42;

// The folder that holds 0001_foundation.sql and every later file.
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations/", import.meta.url));

// One migration file on disk: its number, its name without .sql, and its full path.
export type MigrationFile = { number: number; name: string; path: string };

// What one migrate run did: the files it applied, in order, and the highest number now recorded.
export type MigrationReport = { applied: string[]; schemaVersion: number };

// The grants to the app roles on Graphile's tables. They exist only after Graphile's own migrations have run.
// The worker keeps every right. The API gets only what add_job needs: read and insert on the three tables add_job touches,
// all of which have row security on. add_job also runs an UPDATE on the jobs table on every call, so the API gets UPDATE on
// that one table; with no UPDATE policy for app_api, that UPDATE matches no row. Graphile's client reads its migrations
// table at start to see that nothing is pending, so the API may read that table (it holds migration ids, no user data) and
// never write it. The crontab table and the jobs view get nothing; the view has no row security.
const GRAPHILE_GRANTS = `
GRANT ALL ON ALL TABLES IN SCHEMA graphile_worker TO app_worker;
GRANT ALL ON ALL SEQUENCES IN SCHEMA graphile_worker TO app_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO app_api, app_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA graphile_worker FROM app_api;
GRANT SELECT, INSERT ON graphile_worker._private_jobs, graphile_worker._private_tasks, graphile_worker._private_job_queues TO app_api;
GRANT SELECT ON graphile_worker.migrations TO app_api;
GRANT UPDATE ON graphile_worker._private_jobs TO app_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA graphile_worker TO app_api;
`;

// Gives each Graphile table with row security on its three policies, one per role need; a policy that exists is left alone, so a second run changes nothing.
const GRAPHILE_POLICIES = `
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'graphile_worker' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = tbl.oid AND polname = tbl.relname || '_app_worker') THEN
      EXECUTE format('CREATE POLICY %I ON graphile_worker.%I FOR ALL TO app_worker USING (true) WITH CHECK (true)', tbl.relname || '_app_worker', tbl.relname);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = tbl.oid AND polname = tbl.relname || '_app_api_read') THEN
      EXECUTE format('CREATE POLICY %I ON graphile_worker.%I FOR SELECT TO app_api USING (true)', tbl.relname || '_app_api_read', tbl.relname);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = tbl.oid AND polname = tbl.relname || '_app_api_add') THEN
      EXECUTE format('CREATE POLICY %I ON graphile_worker.%I FOR INSERT TO app_api WITH CHECK (true)', tbl.relname || '_app_api_add', tbl.relname);
    END IF;
  END LOOP;
END
$$;
`;

// The two catalog checks each migration file must pass before it commits (the definer rule).
const RLS_MISSING_QUERY = `
SELECT c.relname AS name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
ORDER BY c.relname COLLATE "C"`;
const DEFINER_UNSAFE_QUERY = `
SELECT p.proname AS name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND (pg_get_userbyid(p.proowner) <> 'app_definer'
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
ORDER BY p.proname COLLATE "C"`;

// Lists the .sql files of a folder in number order and refuses a bad name, a repeated number or a missing package line.
export async function listMigrationFiles(folder: string): Promise<MigrationFile[]> {
  const entries = (await readdir(folder)).filter((entry) => entry.endsWith(".sql")).sort();
  const seen = new Set<number>();
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const match = /^([0-9]{4})_([a-z0-9_]+)\.sql$/.exec(entry);
    if (match === null)
      throw new ContractError(
        "migration_name_invalid",
        `${entry} is not named like 0002_short_words.sql. Rename it with a four-digit number from ranges.txt.`,
        500,
      );
    const number = Number(match[1]);
    if (seen.has(number))
      throw new ContractError(
        "migration_number_repeated",
        `Two migration files use number ${match[1] ?? ""}. Give the newer one the next free number from ranges.txt.`,
        500,
      );
    const path = join(folder, entry);
    const firstLine = (await readFile(path, "utf8")).split("\n")[0]?.replace(/\r$/, "");
    if (firstLine !== "-- package: db")
      throw new ContractError(
        "migration_package_missing",
        `${entry} does not start with the line "-- package: db". Add it as the first line.`,
        500,
      );
    seen.add(number);
    files.push({ number, name: entry.slice(0, -4), path });
  }
  return files;
}

// Refuses a migration file that would leave a table without forced row security, or a definer function outside app_definer.
async function assertSchemaSafety(client: pg.Client): Promise<void> {
  const tables = await client.query<{ name: string }>(RLS_MISSING_QUERY);
  if (tables.rows.length > 0) {
    const names = tables.rows.map((row) => row.name).join(", ");
    throw new ContractError(
      "migration_rls_missing",
      `The migration would leave ${names} without forced row security and a policy, so it was rolled back. Add ENABLE and FORCE ROW LEVEL SECURITY and a CREATE POLICY for each.`,
      500,
    );
  }
  const functions = await client.query<{ name: string }>(DEFINER_UNSAFE_QUERY);
  if (functions.rows.length > 0) {
    const names = functions.rows.map((row) => row.name).join(", ");
    throw new ContractError(
      "migration_definer_unsafe",
      `The migration would leave ${names} running as its owner without belonging to app_definer, or callable by anyone, so it was rolled back. Check its ALTER FUNCTION and REVOKE lines.`,
      500,
    );
  }
}

// Applies one migration file in its own transaction, with its schema_migrations row, or not at all.
async function applyFile(client: pg.Client, file: MigrationFile): Promise<void> {
  const text = await readFile(file.path, "utf8");
  await client.query("BEGIN");
  try {
    await client.query(text);
    if (file.number > 1)
      await client.query("INSERT INTO schema_migrations (number, name) VALUES ($1, $2)", [
        file.number,
        file.name,
      ]);
    await assertSchemaSafety(client);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// The numbers already recorded in schema_migrations, or none when the table does not exist yet (a database before 0001).
async function appliedNumbers(client: pg.Client): Promise<Set<number>> {
  const present = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present",
  );
  if (present.rows[0]?.present !== true) return new Set();
  const rows = await client.query<{ number: number }>("SELECT number FROM schema_migrations");
  return new Set(rows.rows.map((row) => row.number));
}

// Applies every file not yet recorded, in number order, and returns the names applied.
async function applyDueFiles(client: pg.Client, files: MigrationFile[]): Promise<string[]> {
  const done = await appliedNumbers(client);
  if (done.size === 0 && files[0]?.number !== 1) {
    throw new ContractError(
      "migration_foundation_missing",
      "The first migration to run must be 0001_foundation.sql. Check the migrations folder.",
      500,
    );
  }
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file.number)) continue;
    await applyFile(client, file);
    applied.push(file.name);
  }
  return applied;
}

// Runs the SQL files, then Graphile Worker's own migrations, then the Graphile grants, all under one advisory lock.
export async function migrateDatabase(
  databaseUrl: string,
  folder: string = MIGRATIONS_FOLDER,
): Promise<MigrationReport> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    // 0001 grants on this schema, so it must exist before the first file runs; Graphile's own migrations find it already there.
    await client.query("CREATE SCHEMA IF NOT EXISTS graphile_worker AUTHORIZATION CURRENT_USER");
    const applied = await applyDueFiles(client, await listMigrationFiles(folder));
    await runGraphileMigrations({ connectionString: databaseUrl });
    await client.query(GRAPHILE_GRANTS);
    await client.query(GRAPHILE_POLICIES);
    const version = await client.query<{ version: number | null }>(
      "SELECT max(number) AS version FROM schema_migrations",
    );
    return { applied, schemaVersion: numberFromPostgres(version.rows[0]?.version ?? 0) };
  } finally {
    await client.end();
  }
}

// Reads the highest migration number recorded in schema_migrations, or 0 when none is.
export async function readSchemaVersion(db: Kysely<Database>): Promise<number> {
  const row = await db
    .selectFrom("schema_migrations")
    .select((eb) => eb.fn.max("number").as("version"))
    .executeTakeFirst();
  return numberFromPostgres(row?.version ?? 0);
}

// Refuses to go on when the database is not at the version this build expects; the worker calls it at boot.
export async function assertSchemaVersion(db: Kysely<Database>, expected: number): Promise<void> {
  const found = await readSchemaVersion(db);
  if (found !== expected) {
    throw new ContractError(
      "schema_version_mismatch",
      `The database is at schema version ${String(found)} and this build expects ${String(expected)}. Run pnpm db:migrate from the api service, then start again.`,
      500,
    );
  }
}

// The private command body: reads the migrate variable, runs every due migration and prints one line.
async function main(): Promise<void> {
  const env = migrateEnv.safeParse(process.env);
  if (!env.success) {
    const names = env.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new ContractError("env_missing", `Set ${names} before running this command.`, 500);
  }
  const report = await migrateDatabase(env.data.DATABASE_URL_MIGRATE);
  if (report.applied.length > 0)
    console.log(
      `migrate: applied ${report.applied.join(", ")}; schema version ${String(report.schemaVersion)}`,
    );
  else console.log(`migrate: nothing to apply; schema version ${String(report.schemaVersion)}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`migrate failed: ${describeError(error)}`);
      process.exit(1);
    },
  );
}
