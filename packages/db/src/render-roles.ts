import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { ContractError } from "@meet-first/contracts";
import { describeError } from "./database-errors.js";
import { migrateDatabase, type MigrationReport } from "./migrate.js";

// The one-time role setup on Render. Render's database comes with one default user that owns the database and is not a
// superuser. Run once from this machine as that user, this command makes the four roles migration 0001 expects, gives
// app_migrate the rights it has in a local rebuild, applies every migration, and writes the three role URLs to git-ignored
// files to paste into the Render dashboard. It prints no password and no URL. A second run gives the three login roles new
// passwords and writes the files again.

// The repository root, where .env.render is read and the three files are written.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// The three roles that log in (R9.1, D55); app_definer never logs in.
const LOGIN_ROLES = ["app_migrate", "app_api", "app_worker"] as const;
type LoginRole = (typeof LOGIN_ROLES)[number];
// The new password of each login role, made fresh on every run.
export type RolePasswords = Record<LoginRole, string>;
// One role's name and password, which make the user part of its URL.
type Login = { role: LoginRole; password: string };

// How the setup's connections use TLS. verify (the default) checks the server's certificate against this machine's trusted
// authorities. encrypt-only, chosen with RENDER_DB_TLS=encrypt-only, encrypts without checking, the way the psql command on the
// database's Info page connects. plain, chosen with sslmode=disable on the external URL, is for a Postgres on this machine only.
export type TlsMode = "verify" | "encrypt-only" | "plain";

// What Ambar copies into .env.render: the two URLs on the database's Info page, and the api service's address.
export type RenderInputs = { externalUrl: string; internalUrl: string; appOrigin: string; tls: TlsMode };

// The hosts plain connections may go to.
const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

// Node's codes for a certificate the client could not check, which verify turns into a refusal that names encrypt-only.
const CERTIFICATE_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_UNTRUSTED", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"]);

// What one run did: the files it wrote, and the migrations it applied with the schema version they reached.
export type RenderSetupReport = { files: string[]; migration: MigrationReport };

// The database names the setup accepts, the same rule as a local rebuild (fresh.ts).
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

// The attributes each login role is made with: those of a local rebuild (fresh.ts), except that app_migrate gets no CREATEROLE.
// Every role exists before the first migration, so 0001 makes none, and CREATEROLE together with the admin grant on app_definer
// below would let app_migrate give app_definer a password.
const LOGIN_ATTRIBUTES: Record<LoginRole, string> = {
  app_migrate: "LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE",
  app_api: "LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE",
  app_worker: "LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE",
};

// The rights app_migrate needs on Render, where the default user owns the database and its public schema. In a local rebuild
// app_migrate owns the database, and through it the public schema, so it has all of them by ownership.
// CREATE on the database: migrate.ts makes the graphile_worker schema.
// The extensions, before public changes hands: Render adds one through CREATE EXTENSION by the default user
// (render.com/docs/postgresql-extensions), and 0001's CREATE EXTENSION IF NOT EXISTS then finds them.
// public owned by app_migrate: 0007 drops functions that 0006 handed to app_definer, which only their owner or the schema's
// owner may do, and the migrations give rights on public to the other roles. Handing a schema to a role needs SET on that role
// (PostgreSQL 16), which the default user grants itself for the handover and takes back after it. A second run finds
// app_migrate already the owner, and PostgreSQL then changes nothing.
// app_definer with ADMIN and SET: 0001 grants app_definer to its own runner, which needs ADMIN, and each handover needs SET. A
// local rebuild takes this membership back after migrating (fresh.ts); here it stays, because the api's pre-deploy command
// migrates on every deploy (D71). INHERIT FALSE keeps app_definer's rights out of app_migrate's own queries.
const DATABASE_GRANTS = ["GRANT CONNECT, CREATE ON DATABASE %I TO app_migrate", "GRANT CONNECT ON DATABASE %I TO app_api, app_worker"];
const OTHER_GRANTS = [
  "CREATE EXTENSION IF NOT EXISTS pgcrypto",
  "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  "GRANT app_migrate TO CURRENT_USER WITH SET TRUE, INHERIT FALSE",
  "ALTER SCHEMA public OWNER TO app_migrate",
  "REVOKE app_migrate FROM CURRENT_USER",
  "GRANT app_definer TO app_migrate WITH ADMIN OPTION, INHERIT FALSE, SET TRUE",
];

// One role as pg_roles describes it.
export type RoleRow = { rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean; rolcreaterole: boolean; rolcreatedb: boolean };

// Throws the refusal for a setup that must not go on.
function refuse(code: string, sentence: string): never {
  throw new ContractError(code, sentence, 500);
}

// Parses one input as a URL, or refuses with the variable's name.
function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    return refuse("render_url_invalid", `${name} is not a URL. Copy it again from the Render dashboard.`);
  }
}

// Reads and checks the inputs; it refuses before any connection is opened.
export function readRenderInputs(env: Record<string, string | undefined>): RenderInputs {
  const read = (name: string): string => (env[name] ?? "").trim();
  const names = ["RENDER_DB_EXTERNAL_URL", "RENDER_DB_INTERNAL_URL", "APP_ORIGIN"];
  const missing = names.filter((name) => read(name) === "");
  if (missing.length > 0) refuse("render_env_missing", `Set ${missing.join(", ")} in .env.render at the repository root: the External and Internal Database URLs from the database's Info page, and the api service's address.`);
  const external = parseUrl("RENDER_DB_EXTERNAL_URL", read("RENDER_DB_EXTERNAL_URL"));
  const internal = parseUrl("RENDER_DB_INTERNAL_URL", read("RENDER_DB_INTERNAL_URL"));
  const origin = parseUrl("APP_ORIGIN", read("APP_ORIGIN"));
  checkDatabaseUrls(external, internal);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search !== "") refuse("render_origin_not_https", "APP_ORIGIN must be the api service's https address with no path, such as https://meet-first-api.onrender.com.");
  return { externalUrl: external.toString(), internalUrl: internal.toString(), appOrigin: origin.origin, tls: tlsModeOf(external, read("RENDER_DB_TLS")) };
}

// Refuses two database URLs that are not the External and Internal Database URLs of one database's default user.
function checkDatabaseUrls(external: URL, internal: URL): void {
  for (const url of [external, internal]) {
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") refuse("render_url_not_postgres", "Both database URLs must start with postgresql://. Copy them again from the database's Info page.");
  }
  if (external.hostname === internal.hostname) refuse("render_urls_same_host", "RENDER_DB_INTERNAL_URL names the same host as RENDER_DB_EXTERNAL_URL. Copy the Internal Database URL into it.");
  if (external.username !== internal.username || external.password !== internal.password || external.pathname !== internal.pathname) {
    refuse("render_urls_disagree", "The two database URLs name different users or databases. Copy both from the Info page of the same database.");
  }
  if ([...LOGIN_ROLES, "app_definer"].includes(decodeURIComponent(external.username))) {
    refuse("render_url_not_owner", "The database URLs must log in as the database's default user, the one on its Info page, not as an app role.");
  }
  if (!NAME_PATTERN.test(external.pathname.slice(1))) refuse("render_bad_database_name", "The database name must be lower-case letters, digits and underscores, starting with a letter.");
}

// The TLS mode for the external URL and the RENDER_DB_TLS setting; plain is refused for a host that is not this machine.
function tlsModeOf(external: URL, setting: string): TlsMode {
  if (external.searchParams.get("sslmode") === "disable") {
    if (!LOCAL_HOSTS.includes(external.hostname)) refuse("render_tls_plain_remote", "sslmode=disable is only for a Postgres on this machine. Remove it from RENDER_DB_EXTERNAL_URL.");
    return "plain";
  }
  if (setting === "") return "verify";
  if (setting === "encrypt-only") return "encrypt-only";
  return refuse("render_tls_setting_unknown", "RENDER_DB_TLS takes one value, encrypt-only. Remove the line to check the certificate.");
}

// The problems with the four roles as they stand, none when each has the attributes the migrations and the row policies rely
// on. A role that already existed with other attributes is reported, never changed.
export function roleProblems(rows: readonly RoleRow[]): string[] {
  return [...LOGIN_ROLES, "app_definer"].flatMap((name) => {
    const row = rows.find((candidate) => candidate.rolname === name);
    return row === undefined ? [`${name} is missing`] : problemsOfRole(name, row);
  });
}

// The problems with one role that exists.
function problemsOfRole(name: string, row: RoleRow): string[] {
  const problems: string[] = [];
  if (row.rolsuper || row.rolbypassrls) problems.push(`${name} can skip row security`);
  if (row.rolcreaterole || row.rolcreatedb) problems.push(`${name} may create roles or databases`);
  if (row.rolcanlogin !== (name !== "app_definer")) problems.push(row.rolcanlogin ? `${name} can log in` : `${name} cannot log in`);
  if (name !== "app_migrate" && row.rolinherit) problems.push(`${name} inherits the rights of the roles it belongs to`);
  return problems;
}

// The SCRAM-SHA-256 secret Postgres stores for a password (RFC 5802, RFC 7677). It is made here so that the password itself
// never reaches the server or its logs; 4096 iterations is Postgres's default.
export function scramSecret(password: string, salt: Buffer = randomBytes(16)): string {
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

// The URL one role logs in with: the host, port and database of base, the role's name and password, and the given query.
function roleUrl(base: string, login: Login, query: string): string {
  const url = new URL(base);
  url.username = login.role;
  url.password = login.password;
  url.search = query;
  return url.toString();
}

// The three git-ignored files the setup writes: each service's variables for Render, on the internal host (Render's private
// network), and .env.wave3 for scripts/check-wave-3.sh, on the external host, where psql encrypts with sslmode=require.
export function renderFiles(inputs: RenderInputs, passwords: RolePasswords): Record<string, string> {
  const internal = (role: LoginRole): string => roleUrl(inputs.internalUrl, { role, password: passwords[role] }, "");
  const externalWorker = roleUrl(inputs.externalUrl, { role: "app_worker", password: passwords.app_worker }, "?sslmode=require");
  return {
    ".env.render-api": `DATABASE_URL_MIGRATE=${internal("app_migrate")}\nDATABASE_URL_API=${internal("app_api")}\nAPP_ORIGIN=${inputs.appOrigin}\n`,
    ".env.render-worker": `DATABASE_URL_WORKER=${internal("app_worker")}\n`,
    ".env.wave3": `APP_ORIGIN=${inputs.appOrigin}\nDATABASE_URL_WORKER=${externalWorker}\n`,
  };
}

// The pg TLS option of each mode, and the query that gives a connection string the same TLS, for code that takes only a
// connection string (migrate.ts).
const TLS_OPTION: Record<TlsMode, pg.ClientConfig["ssl"]> = { verify: true, "encrypt-only": { rejectUnauthorized: false }, plain: false };
const TLS_QUERY: Record<TlsMode, string> = { verify: "?sslmode=verify-full", "encrypt-only": "?sslmode=no-verify", plain: "?sslmode=disable" };

// Opens a connection to one URL with the given TLS mode; a certificate that verify cannot check is refused with the way out.
async function connectTo(url: string, tls: TlsMode): Promise<pg.Client> {
  const target = new URL(url);
  target.search = "";
  const client = new pg.Client({ connectionString: target.toString(), ssl: TLS_OPTION[tls] });
  try {
    await client.connect();
  } catch (error: unknown) {
    const code: unknown = Reflect.get(error ?? {}, "code");
    if (tls === "verify" && typeof code === "string" && CERTIFICATE_CODES.has(code)) {
      refuse("render_tls_unverified", `The database's certificate could not be checked (${code}). To connect encrypted without checking it, the way the psql command on the Info page does, add RENDER_DB_TLS=encrypt-only to .env.render and run again.`);
    }
    throw error;
  }
  return client;
}

// Runs one format statement on the owner's connection; format quotes each value, so no text is pasted into SQL by hand.
async function runFormatted(owner: pg.Client, template: string, values: string[]): Promise<void> {
  const placeholders = values.map((value, index) => `$${String(index + 2)}::text`).join(", ");
  const built = await owner.query<{ statement: string }>(`SELECT format($1::text, ${placeholders}) AS statement`, [template, ...values]);
  await owner.query(built.rows[0]?.statement ?? "SELECT 1");
}

// True when a role of that name exists.
async function roleExists(owner: pg.Client, role: string): Promise<boolean> {
  const found = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  return (found.rowCount ?? 0) > 0;
}

// Creates each missing role, and gives each login role its new password as a SCRAM secret.
async function makeRoles(owner: pg.Client, passwords: RolePasswords): Promise<void> {
  if (!(await roleExists(owner, "app_definer"))) await owner.query("CREATE ROLE app_definer NOLOGIN NOBYPASSRLS NOINHERIT");
  for (const role of LOGIN_ROLES) {
    const template = (await roleExists(owner, role)) ? "ALTER ROLE %I LOGIN PASSWORD %L" : `CREATE ROLE %I ${LOGIN_ATTRIBUTES[role]} PASSWORD %L`;
    await runFormatted(owner, template, [role, scramSecret(passwords[role])]);
  }
}

// Refuses a server older than PostgreSQL 16, whose GRANT has no SET and INHERIT options (0001).
async function assertPostgres16(owner: pg.Client): Promise<void> {
  const found = await owner.query<{ version: number }>("SELECT current_setting('server_version_num')::int AS version");
  if ((found.rows[0]?.version ?? 0) < 160000) refuse("render_postgres_old", "The database runs a PostgreSQL older than 16. render.yaml asks for 16; make the database again from the Blueprint.");
}

// Makes the roles, checks them, and grants app_migrate's rights, in one transaction, so a failed run changes nothing.
async function setUpRoles(owner: pg.Client, databaseName: string, passwords: RolePasswords): Promise<void> {
  await owner.query("BEGIN");
  try {
    await makeRoles(owner, passwords);
    const rows = await owner.query<RoleRow>(
      "SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = ANY($1::text[])",
      [[...LOGIN_ROLES, "app_definer"]],
    );
    const problems = roleProblems(rows.rows);
    if (problems.length > 0) refuse("render_roles_wrong", `The roles on this database are not the ones the migrations expect: ${problems.join("; ")}. Nothing was changed.`);
    for (const template of DATABASE_GRANTS) await runFormatted(owner, template, [databaseName]);
    for (const statement of OTHER_GRANTS) await owner.query(statement);
    await owner.query("COMMIT");
  } catch (error: unknown) {
    await owner.query("ROLLBACK");
    throw error;
  }
}

// Logs in once as a role through the external address, so a wrong password shows here and not in a Render deploy.
async function assertLogin(url: string, role: LoginRole, tls: TlsMode): Promise<void> {
  const client = await connectTo(url, tls);
  try {
    const found = await client.query<{ login: string }>("SELECT current_user AS login");
    if (found.rows[0]?.login !== role) refuse("render_login_wrong", `Logging in as ${role} gave another role. Run pnpm db:render-roles again.`);
  } finally {
    await client.end();
  }
}

// Writes each file readable by this user only, and returns their names.
function writeFiles(folder: string, files: Record<string, string>): string[] {
  for (const [name, text] of Object.entries(files)) {
    const path = join(folder, name);
    writeFileSync(path, text, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  return Object.keys(files);
}

// Sets up the roles, writes the three files into folder (before anything else can fail, so the new passwords are never lost),
// checks that the two runtime roles can log in through the external address, and applies every migration as app_migrate.
export async function setUpRenderRoles(inputs: RenderInputs, folder: string): Promise<RenderSetupReport> {
  const databaseName = new URL(inputs.externalUrl).pathname.slice(1);
  const passwords: RolePasswords = { app_migrate: randomBytes(24).toString("base64url"), app_api: randomBytes(24).toString("base64url"), app_worker: randomBytes(24).toString("base64url") };
  const owner = await connectTo(inputs.externalUrl, inputs.tls);
  try {
    await assertPostgres16(owner);
    await setUpRoles(owner, databaseName, passwords);
  } finally {
    await owner.end();
  }
  const files = writeFiles(folder, renderFiles(inputs, passwords));
  const query = TLS_QUERY[inputs.tls];
  for (const role of ["app_api", "app_worker"] as const) await assertLogin(roleUrl(inputs.externalUrl, { role, password: passwords[role] }, query), role, inputs.tls);
  const migration = await migrateDatabase(roleUrl(inputs.externalUrl, { role: "app_migrate", password: passwords.app_migrate }, query));
  return { files, migration };
}

// The private command body: reads .env.render when it is there, runs the setup, and prints what it did with no password or URL.
async function main(): Promise<void> {
  const envFile = join(REPO_ROOT, ".env.render");
  if (existsSync(envFile)) loadEnvFile(envFile);
  const report = await setUpRenderRoles(readRenderInputs(process.env), REPO_ROOT);
  const applied = report.migration.applied.length > 0 ? `applied ${report.migration.applied.join(", ")}` : "nothing to apply";
  console.log(`render-roles: the four roles and app_migrate's rights are set; migrate: ${applied}; schema version ${String(report.migration.schemaVersion)}`);
  console.log(`render-roles: wrote ${report.files.join(", ")} at the repository root (git-ignored). Paste both .env.render-api and .env.render-worker into the meet-first service on Render.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`render-roles failed: ${describeError(error)}`);
      process.exit(1);
    },
  );
}
