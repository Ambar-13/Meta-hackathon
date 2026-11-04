import type { Kysely } from "kysely";
import { ContractError } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE } from "../client.js";
import { dropDatabase, recreateDatabase, type RebuildUrls } from "../fresh.js";
import type { Database } from "../types.js";

// What freshTestDatabase hands a test: a client as app_api, the three role URLs, and the function that drops the database.
export type TestDatabase = {
  db: Kysely<Database>;
  migrateUrl: string;
  apiUrl: string;
  workerUrl: string;
  drop: () => Promise<void>;
};

// Reads DATABASE_URL_ADMIN and DATABASE_URL_TEST and works out the api and worker URLs from the test URL.
export function readTestDatabaseUrls(env: NodeJS.ProcessEnv): RebuildUrls {
  const adminUrl = env.DATABASE_URL_ADMIN;
  const testUrl = env.DATABASE_URL_TEST;
  if (adminUrl === undefined || adminUrl === "" || testUrl === undefined || testUrl === "") {
    throw new ContractError(
      "test_database_env_missing",
      "Set DATABASE_URL_ADMIN and DATABASE_URL_TEST before running the Postgres tests. See packages/db/README.md.",
      500,
    );
  }
  const parsed = parsePostgresUrls(adminUrl, testUrl);
  if (decodeURIComponent(parsed.test.username) !== "app_migrate") {
    throw new ContractError(
      "test_database_wrong_role",
      "DATABASE_URL_TEST must log in as app_migrate, as .env.example shows.",
      500,
    );
  }
  return {
    adminUrl,
    migrateUrl: testUrl,
    apiUrl: withUser(testUrl, "app_api"),
    workerUrl: withUser(testUrl, "app_worker"),
  };
}

// Parses both variables as postgres:// URLs, or refuses them.
function parsePostgresUrls(adminUrl: string, testUrl: string): { admin: URL; test: URL } {
  try {
    const admin = new URL(adminUrl);
    const test = new URL(testUrl);
    if (admin.protocol !== "postgres:" || test.protocol !== "postgres:")
      throw new Error("not postgres");
    return { admin, test };
  } catch {
    throw new ContractError(
      "test_database_env_invalid",
      "DATABASE_URL_ADMIN and DATABASE_URL_TEST must both be postgres:// URLs.",
      500,
    );
  }
}

// The same URL with another login role, the password, host, port and database kept as they are.
function withUser(url: string, role: string): string {
  const copy = new URL(url);
  copy.username = role;
  return copy.toString();
}

// Vitest global setup: refuses to start the Postgres kinds when the two variables are missing or wrong.
export function setup(): void {
  readTestDatabaseUrls(process.env);
}

// Rebuilds the test database from nothing, applies every migration, and returns a client as app_api.
export async function freshTestDatabase(): Promise<TestDatabase> {
  const urls = readTestDatabaseUrls(process.env);
  await recreateDatabase(urls);
  const db = makeDatabase(urls.apiUrl, POOL_SIZE.test);
  const name = new URL(urls.migrateUrl).pathname.slice(1);
  return {
    db,
    migrateUrl: urls.migrateUrl,
    apiUrl: urls.apiUrl,
    workerUrl: urls.workerUrl,
    drop: async () => {
      await db.destroy();
      await dropDatabase(urls.adminUrl, name);
    },
  };
}
