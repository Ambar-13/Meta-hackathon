import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { makeWorkerUtils } from "graphile-worker";
import type { Kysely } from "kysely";
import { apiEnv, type JobName } from "@meet-first/contracts";
import { makeDatabase, type Database } from "@meet-first/db";
import { freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import type { ApiEnv, Enqueue, RoutePlugin } from "../app-types.js";
import { makeApiEnqueue } from "../job-queue.js";
import { buildApp } from "../server.js";

// The origin every test app runs as, the APP_ORIGIN of .env.example (tests need one fixed value).
export const TEST_APP_ORIGIN = "http://localhost:3000";
// Connections in a test app's pool: 4.
export const TEST_POOL_SIZE = 4;
// One job the test app put on the queue after Graphile accepted it.
export type EnqueuedJob = { name: JobName; payload: unknown };

// What the observers of one test app record: every log line and every job it enqueued.
type Observed = { lines: string[]; jobs: EnqueuedJob[] };
// The records of each test app, by app, so testLogLines and enqueuedJobs can read them.
const records = new WeakMap<FastifyInstance, Observed>();

// Apps alive in this test process. The seeds of @meet-first/db/testing write to the database named in DATABASE_URL_TEST,
// so the first app uses that database; an app that starts while another is alive gets a database of its own, because
// freshTestDatabase would otherwise rebuild the database the other app is using.
let liveApps = 0;

// Rebuilds the database for one test app (see liveApps above).
async function freshDatabaseForApp(): Promise<TestDatabase> {
  const configured = process.env.DATABASE_URL_TEST;
  if (configured === undefined || liveApps === 0) {
    return freshTestDatabase();
  }
  const url = new URL(configured);
  url.pathname = `/${url.pathname.slice(1)}_${randomBytes(4).toString("hex")}`;
  process.env.DATABASE_URL_TEST = url.toString();
  try {
    return await freshTestDatabase();
  } finally {
    process.env.DATABASE_URL_TEST = configured;
  }
}

// Builds the api on a fresh test database with the real hooks, the real job queue and the routes given; every slot when none are given.
export async function buildTestApp(options?: {
  routes?: RoutePlugin[];
  env?: Partial<ApiEnv>;
}): Promise<{ app: FastifyInstance; db: Kysely<Database>; close: () => Promise<void> }> {
  const fresh = await freshDatabaseForApp();
  liveApps += 1;
  const env = apiEnv.parse({
    DATABASE_URL_API: fresh.apiUrl,
    APP_ORIGIN: TEST_APP_ORIGIN,
    ...options?.env,
  });
  const db = makeDatabase(env.DATABASE_URL_API, TEST_POOL_SIZE);
  const workerUtils = await makeWorkerUtils({ connectionString: env.DATABASE_URL_API });
  const lines: string[] = [];
  const logStream = new Writable({
    write(chunk, encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const jobs: EnqueuedJob[] = [];
  const realEnqueue = makeApiEnqueue(workerUtils);
  const enqueue: Enqueue = async (name, payload, enqueueOptions) => {
    await realEnqueue(name, payload, enqueueOptions);
    jobs.push({ name, payload });
  };
  const app = await buildApp(
    { db, env, now: () => new Date(), enqueue },
    { routes: options?.routes ?? "all", logStream },
  );
  await app.ready();
  records.set(app, { lines, jobs });
  const close = async (): Promise<void> => {
    // A test's HTTP client can leave a socket open after its last response, and the server would then wait for it.
    app.server.closeAllConnections();
    try {
      await app.close();
      await workerUtils.release();
      await db.destroy();
      await fresh.drop();
    } finally {
      liveApps -= 1;
    }
  };
  return { app, db, close };
}

// Every log line the test app wrote, in order, so a test can prove that no token reached the log.
export function testLogLines(app: FastifyInstance): string[] {
  return readRecords(app).lines;
}

// Every job the test app enqueued after the queue accepted it, in order.
export function enqueuedJobs(app: FastifyInstance): EnqueuedJob[] {
  return readRecords(app).jobs;
}

// The records of an app made by buildTestApp; any other app is a test mistake.
function readRecords(app: FastifyInstance): Observed {
  const found = records.get(app);
  if (found === undefined) {
    throw new Error("this app was not made by buildTestApp");
  }
  return found;
}
