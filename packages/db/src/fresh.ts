import { pathToFileURL } from "node:url";
import pg from "pg";
import { ContractError, apiEnv, migrateEnv, workerEnv } from "@meet-first/contracts";
import { describeError } from "./database-errors.js";
import { migrateDatabase, type MigrationReport } from "./migrate.js";

// The four connection strings a rebuild needs: a superuser on this machine, and the three app roles on the target database.
export type RebuildUrls = { adminUrl: string; migrateUrl: string; apiUrl: string; workerUrl: string };

// The hosts a rebuild may touch; any other host is refused before a statement runs [confirm].
export const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

// The database names a rebuild accepts: lower-case letters, digits and underscores, starting with a letter.
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

// Throws the refusal for a rebuild that would touch a host or a name it must not.
function refuse(code: string, sentence: string): never {
  throw new ContractError(code, sentence, 500);
}

// Refuses a URL whose host is not on this machine.
function assertLocalHosts(urls: RebuildUrls): void {
  for (const url of [urls.adminUrl, urls.migrateUrl, urls.apiUrl, urls.workerUrl]) {
    if (!LOCAL_HOSTS.includes(new URL(url).hostname)) refuse("fresh_not_local", "This command only rebuilds a database on this machine. Point every URL at localhost or 127.0.0.1.");
  }
}

// Refuses URLs that name different hosts, ports or databases.
function assertSameTarget(urls: RebuildUrls): void {
  const admin = new URL(urls.adminUrl);
  const migrate = new URL(urls.migrateUrl);
  const others = [new URL(urls.migrateUrl), new URL(urls.apiUrl), new URL(urls.workerUrl)];
  const isSameHost = others.every((url) => url.hostname === admin.hostname && url.port === admin.port);
  const isSameDatabase = others.every((url) => url.pathname === migrate.pathname);
  if (!isSameHost || !isSameDatabase) refuse("fresh_urls_disagree", "The admin, migrate, api and worker URLs must name one host and port, and the last three one database.");
}

// Refuses URLs that log in as the wrong role.
function assertRoles(urls: RebuildUrls): void {
  const expected: Array<[string, string]> = [[urls.migrateUrl, "app_migrate"], [urls.apiUrl, "app_api"], [urls.workerUrl, "app_worker"]];
  for (const [url, role] of expected) {
    if (decodeURIComponent(new URL(url).username) !== role) refuse("fresh_wrong_role", "The migrate, api and worker URLs must log in as app_migrate, app_api and app_worker.");
  }
}

// Checks the four URLs and returns the target database name; it refuses before anything is dropped.
export function checkRebuildUrls(urls: RebuildUrls): string {
  assertLocalHosts(urls);
  assertSameTarget(urls);
  assertRoles(urls);
  const name = new URL(urls.migrateUrl).pathname.slice(1);
  if (!NAME_PATTERN.test(name)) refuse("fresh_bad_database_name", "The target database name must be lower-case letters, digits and underscores, starting with a letter.");
  if (new URL(urls.adminUrl).pathname.slice(1) === name) refuse("fresh_admin_is_target", "DATABASE_URL_ADMIN must point at another database, such as postgres, because the target is dropped.");
  return name;
}

// Opens one admin connection on a URL and returns it connected.
async function connectTo(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

// Creates a role when it is missing; the attributes are the ones migration 0001 expects, and app_migrate may create roles.
async function createRoleIfMissing(admin: pg.Client, role: string, statement: string): Promise<void> {
  const found = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (found.rowCount === 0) await admin.query(statement);
}

// Creates the four roles when missing, so migration 0001 creates nothing of its own.
async function createMissingRoles(admin: pg.Client): Promise<void> {
  await createRoleIfMissing(admin, "app_migrate", "CREATE ROLE app_migrate LOGIN NOBYPASSRLS CREATEROLE");
  await createRoleIfMissing(admin, "app_api", "CREATE ROLE app_api LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE");
  await createRoleIfMissing(admin, "app_worker", "CREATE ROLE app_worker LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE");
  await createRoleIfMissing(admin, "app_definer", "CREATE ROLE app_definer NOLOGIN NOBYPASSRLS NOINHERIT");
}

// Sets one role's password from its URL when the URL carries one; format quotes the value, so no text is pasted into SQL by hand.
async function setPasswordFromUrl(admin: pg.Client, url: string, role: string): Promise<void> {
  const password = decodeURIComponent(new URL(url).password);
  if (password === "") return;
  const built = await admin.query<{ statement: string }>("SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS statement", [role, password]);
  await admin.query(built.rows[0]?.statement ?? "SELECT 1");
}

// Runs one format statement on the admin connection, with the database name it quotes.
async function runFormatted(admin: pg.Client, template: string, name: string): Promise<void> {
  const built = await admin.query<{ statement: string }>("SELECT format($1::text, $2::text) AS statement", [template, name]);
  await admin.query(built.rows[0]?.statement ?? "SELECT 1");
}

// Recreates the target database empty and owned by app_migrate.
async function replaceDatabase(admin: pg.Client, name: string): Promise<void> {
  await runFormatted(admin, "DROP DATABASE IF EXISTS %I WITH (FORCE)", name);
  await runFormatted(admin, "CREATE DATABASE %I OWNER app_migrate", name);
}

// The connection string for the same server with another database as its path.
function urlForDatabase(url: string, name: string): string {
  const target = new URL(url);
  target.pathname = `/${name}`;
  return target.toString();
}

// Creates the four roles when missing, sets their passwords from the URLs, recreates the target database empty, and lets app_migrate act as app_definer until the returned function runs.
export async function prepareEmptyDatabase(urls: RebuildUrls): Promise<() => Promise<void>> {
  const name = checkRebuildUrls(urls);
  const admin = await connectTo(urls.adminUrl);
  try {
    await createMissingRoles(admin);
    await setPasswordFromUrl(admin, urls.migrateUrl, "app_migrate");
    await setPasswordFromUrl(admin, urls.apiUrl, "app_api");
    await setPasswordFromUrl(admin, urls.workerUrl, "app_worker");
    await replaceDatabase(admin, name);
    const target = await connectTo(urlForDatabase(urls.adminUrl, name));
    try {
      await target.query("GRANT CREATE ON SCHEMA public TO app_definer");
    } finally {
      await target.end();
    }
    // INHERIT FALSE: during the run app_migrate may become app_definer to hand it functions, but never reads through its policies.
    await admin.query("GRANT app_definer TO app_migrate WITH ADMIN OPTION, INHERIT FALSE, SET TRUE");
  } finally {
    await admin.end();
  }
  return () => releaseGrants(urls, name);
}

// Takes back the two grants prepareEmptyDatabase made for one run, so app_migrate stays filtered afterwards.
async function releaseGrants(urls: RebuildUrls, name: string): Promise<void> {
  const admin = await connectTo(urls.adminUrl);
  try {
    await admin.query("REVOKE app_definer FROM app_migrate CASCADE");
  } finally {
    await admin.end();
  }
  const target = await connectTo(urlForDatabase(urls.adminUrl, name));
  try {
    await target.query("REVOKE CREATE ON SCHEMA public FROM app_definer");
  } finally {
    await target.end();
  }
}

// Drops one database on this machine through the admin connection.
export async function dropDatabase(adminUrl: string, databaseName: string): Promise<void> {
  assertLocalHosts({ adminUrl, migrateUrl: adminUrl, apiUrl: adminUrl, workerUrl: adminUrl });
  if (!NAME_PATTERN.test(databaseName)) refuse("fresh_bad_database_name", "The target database name must be lower-case letters, digits and underscores, starting with a letter.");
  if (new URL(adminUrl).pathname.slice(1) === databaseName) refuse("fresh_admin_is_target", "DATABASE_URL_ADMIN must point at another database, such as postgres, because the target is dropped.");
  const admin = await connectTo(adminUrl);
  try {
    await runFormatted(admin, "DROP DATABASE IF EXISTS %I WITH (FORCE)", databaseName);
  } finally {
    await admin.end();
  }
}

// The advisory lock every rebuild on this Postgres takes on the admin database. The grant and the release of app_definer
// are cluster-wide, so a second rebuild running at the same time (another worktree's tests) could take the grant away
// halfway through the first one's migrations; one rebuild at a time keeps both correct.
const REBUILD_LOCK_KEY = 4_171_026;

// Runs one step while holding the rebuild lock, so no other rebuild on this Postgres is halfway through. Ending the
// connection releases the lock, also when the step throws.
export async function withRebuildLock<T>(adminUrl: string, run: () => Promise<T>): Promise<T> {
  const lock = await connectTo(adminUrl);
  try {
    await lock.query("SELECT pg_advisory_lock($1)", [REBUILD_LOCK_KEY]);
    return await run();
  } finally {
    await lock.end();
  }
}

// Rebuilds the target database from nothing and applies every migration; pnpm db:fresh and freshTestDatabase both call it.
export async function recreateDatabase(urls: RebuildUrls): Promise<MigrationReport> {
  return withRebuildLock(urls.adminUrl, async () => {
    const releaseGrants = await prepareEmptyDatabase(urls);
    try {
      return await migrateDatabase(urls.migrateUrl);
    } finally {
      await releaseGrants();
    }
  });
}

// The variables the rebuild reads: the admin URL beside the three app URLs and the migrate URL.
const freshEnv = migrateEnv.extend({
  DATABASE_URL_API: apiEnv.shape.DATABASE_URL_API,
  DATABASE_URL_WORKER: workerEnv.shape.DATABASE_URL_WORKER,
  DATABASE_URL_ADMIN: migrateEnv.shape.DATABASE_URL_MIGRATE,
});

// The private command body: rebuilds the database named by the migrate URL and prints one line.
async function main(): Promise<void> {
  const env = freshEnv.safeParse(process.env);
  if (!env.success) {
    const names = env.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new ContractError("env_missing", `Set ${names} before running this command.`, 500);
  }
  const urls = { adminUrl: env.data.DATABASE_URL_ADMIN, migrateUrl: env.data.DATABASE_URL_MIGRATE, apiUrl: env.data.DATABASE_URL_API, workerUrl: env.data.DATABASE_URL_WORKER };
  const name = checkRebuildUrls(urls);
  const report = await recreateDatabase(urls);
  console.log(`fresh: rebuilt ${name}; applied ${report.applied.join(", ")}; schema version ${String(report.schemaVersion)}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`fresh failed: ${describeError(error)}`);
      process.exit(1);
    },
  );
}
