import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import pg from "pg";
import { ContractError } from "@meet-first/contracts";
import { makeDatabase, numberFromPostgres } from "./client.js";
import { dropDatabase, prepareEmptyDatabase, type RebuildUrls } from "./fresh.js";
import { assertSchemaVersion, listMigrationFiles, migrateDatabase, MIGRATIONS_FOLDER, readSchemaVersion, SCHEMA_VERSION } from "./migrate.js";
import { readTestDatabaseUrls } from "./testing/index.js";

let urls: RebuildUrls;
let name: string;
let files: Awaited<ReturnType<typeof listMigrationFiles>>;
let names: string[];

// Creates an empty database, applies every real migration to it, and gives the grants back.
async function migratedDatabase(): Promise<void> {
  const release = await prepareEmptyDatabase(urls);
  try {
    await migrateDatabase(urls.migrateUrl);
  } finally {
    await release();
  }
}

// Writes a folder of migration files for one test and returns its path.
async function fakeFolder(entries: Record<string, string>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "db-migrations-"));
  for (const [entry, text] of Object.entries(entries)) await writeFile(join(folder, entry), text, "utf8");
  return folder;
}

// Every real migration file, by file name, so a fake folder can hold copies of them.
async function realFiles(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const file of files) found[`${file.name}.sql`] = await readFile(file.path, "utf8");
  return found;
}

// The error an action throws, or undefined when it succeeds.
async function caughtFrom(act: () => Promise<unknown>): Promise<unknown> {
  return act().then(() => undefined, (caught: unknown) => caught);
}

// The Postgres or contract code read off a thrown value, or undefined.
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
}

beforeAll(async () => {
  urls = readTestDatabaseUrls(process.env);
  name = new URL(urls.migrateUrl).pathname.slice(1);
  files = await listMigrationFiles(MIGRATIONS_FOLDER);
  names = files.map((file) => file.name);
});

afterAll(async () => {
  await dropDatabase(urls.adminUrl, name);
});

describe("migrate", () => {
  it("D71-T1: two migrators started together apply each file once", async () => {
    const release = await prepareEmptyDatabase(urls);
    let reports: Awaited<ReturnType<typeof migrateDatabase>>[] = [];
    try {
      reports = await Promise.all([migrateDatabase(urls.migrateUrl), migrateDatabase(urls.migrateUrl)]);
    } finally {
      await release();
    }
    const api = makeDatabase(urls.apiUrl, 1);
    try {
      const rows = await sql<{ number: number }>`SELECT number FROM schema_migrations ORDER BY number`.execute(api);

      expect(reports.map((report) => report.applied).sort((a, b) => a.length - b.length)).toEqual([[], names]);
      expect(reports.map((report) => report.schemaVersion)).toEqual([files.at(-1)?.number, files.at(-1)?.number]);
      expect(rows.rows.map((row) => row.number)).toEqual(files.map((file) => file.number));
    } finally {
      await api.destroy();
    }
  });

  it("D71-T2: SCHEMA_VERSION equals the highest migration number in the folder", () => {
    expect(files.at(-1)?.number).toBe(SCHEMA_VERSION);
  });

  it("D71-T3: assertSchemaVersion passes at SCHEMA_VERSION and refuses any other", async () => {
    await migratedDatabase();
    const db = makeDatabase(urls.apiUrl, 1);
    try {
      await assertSchemaVersion(db, SCHEMA_VERSION);
      const error = await caughtFrom(() => assertSchemaVersion(db, SCHEMA_VERSION + 1));

      expect(error).toBeInstanceOf(ContractError);
      expect(codeOf(error)).toBe("schema_version_mismatch");
      expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
      expect(Reflect.get(error ?? {}, "message")).toBe(`The database is at schema version ${String(SCHEMA_VERSION)} and this build expects ${String(SCHEMA_VERSION + 1)}. Run pnpm db:migrate from the api service, then start again.`);
    } finally {
      await db.destroy();
    }
  });

  it("D71-T4: the worker role reads the schema version", async () => {
    await migratedDatabase();
    const worker = makeDatabase(urls.workerUrl, 1);
    try {
      expect(await readSchemaVersion(worker)).toBe(SCHEMA_VERSION);
    } finally {
      await worker.destroy();
    }
  });

  it("D71-T5: a migrator waits while another one holds the lock", async () => {
    await migratedDatabase();
    const holder = new pg.Client({ connectionString: urls.migrateUrl });
    await holder.connect();
    await holder.query("SELECT pg_advisory_lock(42)");
    let isSettled = false;
    const run = migrateDatabase(urls.migrateUrl).finally(() => {
      isSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    const wasSettledEarly = isSettled;
    await holder.end();
    const report = await run;

    expect(wasSettledEarly).toBe(false);
    expect(report.applied).toEqual([]);
  });

  it("R12.1-T1: a second run on a migrated database applies nothing", async () => {
    await migratedDatabase();
    const report = await migrateDatabase(urls.migrateUrl);

    expect(report).toEqual({ applied: [], schemaVersion: SCHEMA_VERSION });
  });

  it("R12.1-T2: every migration file starts with the package line and a one-sentence comment", async () => {
    const texts = await Promise.all(files.map((file) => readFile(file.path, "utf8")));
    const lines = texts.map((text) => text.split("\n"));

    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(lines.every((file) => file[0] === "-- package: db")).toBe(true);
    expect(lines.every((file) => /^-- .+\.$/.test(file[1] ?? ""))).toBe(true);
  });

  it("R12.1-T3: refuses two files with one number (uses a fake migrations folder)", async () => {
    const folder = await fakeFolder({ "0001_a.sql": "-- package: db\n-- First.\nSELECT 1;\n", "0001_b.sql": "-- package: db\n-- Second.\nSELECT 1;\n" });
    try {
      const error = await caughtFrom(() => listMigrationFiles(folder));

      expect(codeOf(error)).toBe("migration_number_repeated");
      expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
      expect(Reflect.get(error ?? {}, "message")).toBe("Two migration files use number 0001. Give the newer one the next free number from ranges.txt.");
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  it("R12.1-T4: refuses a file without the package line (uses a fake migrations folder)", async () => {
    const folder = await fakeFolder({ "0001_a.sql": "-- First.\nSELECT 1;\n" });
    try {
      const error = await caughtFrom(() => listMigrationFiles(folder));

      expect(codeOf(error)).toBe("migration_package_missing");
      expect(Reflect.get(error ?? {}, "message")).toBe('0001_a.sql does not start with the line "-- package: db". Add it as the first line.');
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  it("R12.1-T5: refuses a file with a bad name (uses a fake migrations folder)", async () => {
    const folder = await fakeFolder({ "1_a.sql": "-- package: db\n-- First.\nSELECT 1;\n" });
    try {
      const error = await caughtFrom(() => listMigrationFiles(folder));

      expect(codeOf(error)).toBe("migration_name_invalid");
      expect(Reflect.get(error ?? {}, "message")).toBe("1_a.sql is not named like 0002_short_words.sql. Rename it with a four-digit number from ranges.txt.");
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  it("R12.1-T6: refuses an empty database whose first file is not 0001 (uses a fake migrations folder)", async () => {
    const release = await prepareEmptyDatabase(urls);
    const folder = await fakeFolder({ "0002_a.sql": "-- package: db\n-- Second.\nSELECT 1;\n" });
    try {
      const error = await caughtFrom(() => migrateDatabase(urls.migrateUrl, folder));

      expect(codeOf(error)).toBe("migration_foundation_missing");
      expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
      expect(Reflect.get(error ?? {}, "message")).toBe("The first migration to run must be 0001_foundation.sql. Check the migrations folder.");
    } finally {
      await rm(folder, { recursive: true });
      await release();
    }
  });

  it("R9.1-T11: a migration that leaves a table without forced row security is rolled back (uses a fake migrations folder)", async () => {
    const release = await prepareEmptyDatabase(urls);
    const folder = await fakeFolder({ ...(await realFiles()), "9999_unsafe_table.sql": "-- package: db\n-- A table without forced row security, for this test only.\nCREATE TABLE unsafe_table (id int);\n" });
    try {
      const error = await caughtFrom(() => migrateDatabase(urls.migrateUrl, folder));
      const api = makeDatabase(urls.apiUrl, 1);
      try {
        const found = await sql<{ name: string | null }>`SELECT to_regclass('public.unsafe_table') AS name`.execute(api);
        const applied = await sql<{ number: number }>`SELECT number FROM schema_migrations ORDER BY number`.execute(api);

        expect(codeOf(error)).toBe("migration_rls_missing");
        expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
        expect(Reflect.get(error ?? {}, "message")).toBe("The migration would leave unsafe_table without forced row security and a policy, so it was rolled back. Add ENABLE and FORCE ROW LEVEL SECURITY and a CREATE POLICY for each.");
        expect(found.rows[0]?.name).toBeNull();
        expect(applied.rows.map((row) => row.number)).toEqual(files.map((file) => file.number));
      } finally {
        await api.destroy();
      }
    } finally {
      await rm(folder, { recursive: true });
      await release();
    }
  });

  it("R9.1-T12: a definer function not given to app_definer is rolled back (uses a fake migrations folder)", async () => {
    const release = await prepareEmptyDatabase(urls);
    const folder = await fakeFolder({ ...(await realFiles()), "9999_unsafe_definer.sql": "-- package: db\n-- A function that runs as its owner, for this test only.\nCREATE FUNCTION unsafe_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';\n" });
    try {
      const error = await caughtFrom(() => migrateDatabase(urls.migrateUrl, folder));
      const api = makeDatabase(urls.apiUrl, 1);
      try {
        const found = await sql<{ name: string | null }>`SELECT to_regprocedure('public.unsafe_definer()') AS name`.execute(api);

        expect(codeOf(error)).toBe("migration_definer_unsafe");
        expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
        expect(Reflect.get(error ?? {}, "message")).toBe("The migration would leave unsafe_definer running as its owner without belonging to app_definer, or callable by anyone, so it was rolled back. Check its ALTER FUNCTION and REVOKE lines.");
        expect(found.rows[0]?.name).toBeNull();
      } finally {
        await api.destroy();
      }
    } finally {
      await rm(folder, { recursive: true });
      await release();
    }
  });

  it("R9.1-T13: add_job from app_api queues a job the worker can see, and app_api cannot delete one", async () => {
    await migratedDatabase();
    const api = makeDatabase(urls.apiUrl, 1);
    const worker = makeDatabase(urls.workerUrl, 1);
    try {
      await sql`SELECT graphile_worker.add_job('probe_task', '{"x":1}'::json)`.execute(api);
      const queued = await sql<{ n: string }>`SELECT count(*) AS n FROM graphile_worker._private_jobs WHERE task_id = (SELECT id FROM graphile_worker._private_tasks WHERE identifier = 'probe_task')`.execute(worker);
      const refused = await caughtFrom(() => sql`DELETE FROM graphile_worker._private_jobs`.execute(api));

      expect(numberFromPostgres(queued.rows[0]?.n)).toBe(1);
      expect(codeOf(refused)).toBe("42501");
    } finally {
      await api.destroy();
      await worker.destroy();
    }
  });

  it("R9.1-T14: app_api can write only Graphile tables that have row security on, may only read the migrations table, and gets nothing of the jobs view", async () => {
    await migratedDatabase();
    const admin = makeDatabase(urls.migrateUrl, 1);
    try {
      const rows = await sql<{ relname: string; relrowsecurity: boolean; can_read: boolean; can_write: boolean }>`
        SELECT c.relname, c.relrowsecurity,
          has_table_privilege('app_api', c.oid, 'SELECT') AS can_read,
          has_table_privilege('app_api', c.oid, 'INSERT') OR has_table_privilege('app_api', c.oid, 'UPDATE') OR has_table_privilege('app_api', c.oid, 'DELETE') AS can_write
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'graphile_worker' AND c.relkind IN ('r', 'v')
        ORDER BY c.relname`.execute(admin);
      const writable = rows.rows.filter((row) => row.can_write);
      const touched = rows.rows.filter((row) => row.can_read || row.can_write).map((row) => row.relname);

      expect(writable.every((row) => row.relrowsecurity)).toBe(true);
      expect(touched).toEqual(["_private_job_queues", "_private_jobs", "_private_tasks", "migrations"]);
      expect(writable.map((row) => row.relname)).toEqual(["_private_job_queues", "_private_jobs", "_private_tasks"]);
    } finally {
      await admin.destroy();
    }
  });
});
