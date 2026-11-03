import type { FastifyInstance } from "fastify";
import { sql, type Kysely } from "kysely";
import { DISK_DEGRADED_PCT, Health, routes, WORKER_HEARTBEAT_STALE_SECONDS } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";

// The Postgres plan's disk in bytes: 16 GB, the size the design sized every cap for (design field 10, the plan is unverified) (decimal GB is the smaller reading, so degraded comes early, not late).
export const DISK_PLAN_BYTES = 16_000_000_000;
// What health read from the database; a null field means that read gave nothing.
export type HealthReads = { schemaVersion: number | null; workerSeenAt: Date | null; databaseBytes: number | null };

// The database size as a share of the plan's disk, rounded to one decimal place, at most 100.
export function diskPercent(databaseBytes: number, planBytes: number): number {
  return Math.min(100, Math.round((databaseBytes / planBytes) * 1000) / 10);
}

// True when the disk share has reached DISK_DEGRADED_PCT, 80.
export function isDiskDegraded(diskPct: number | null): boolean {
  return diskPct !== null && diskPct >= DISK_DEGRADED_PCT;
}

// True when the worker's heartbeat is less than WORKER_HEARTBEAT_STALE_SECONDS, 120 s, old.
export function isWorkerFresh(workerSeenAt: Date | null, now: Date): boolean {
  return workerSeenAt !== null && now.getTime() - workerSeenAt.getTime() < WORKER_HEARTBEAT_STALE_SECONDS * 1000;
}

// Builds the Health body; null reads mean the database did not answer.
export function toHealth(reads: HealthReads | null, now: Date, planBytes: number): Health {
  if (reads === null) {
    return Health.parse({ ok: false, db: false, worker: false, schemaVersion: 0, diskPct: null, degraded: false });
  }
  const diskPct = reads.databaseBytes === null ? null : diskPercent(reads.databaseBytes, planBytes);
  const isDegraded = isDiskDegraded(diskPct);
  const isWorkerRunning = isWorkerFresh(reads.workerSeenAt, now);
  return Health.parse({ ok: isWorkerRunning && !isDegraded, db: true, worker: isWorkerRunning, schemaVersion: reads.schemaVersion ?? 0, diskPct, degraded: isDegraded });
}

// Reads the schema version, the worker heartbeat and the database size; null when the first two reads fail.
export async function readHealthNumbers(db: Kysely<Database>): Promise<HealthReads | null> {
  let schemaVersion: number | null;
  let workerSeenAt: Date | null;
  try {
    const version = await db.selectFrom("schema_migrations").select((eb) => eb.fn.max("number").as("version")).executeTakeFirst();
    const heartbeat = await db.selectFrom("service_heartbeats").select("seen_at").where("service", "=", "worker").executeTakeFirst();
    schemaVersion = version?.version ?? null;
    workerSeenAt = heartbeat?.seen_at ?? null;
  } catch {
    return null;
  }
  let databaseBytes: number | null;
  try {
    const size = await sql<{ size: string }>`SELECT pg_database_size(current_database()) AS size`.execute(db);
    const bytes = Number(size.rows[0]?.size);
    databaseBytes = Number.isFinite(bytes) ? bytes : null;
  } catch {
    databaseBytes = null;
  }
  return { schemaVersion, workerSeenAt, databaseBytes };
}

// Registers GET /api/health, public: always 200, and the body says what is wrong.
export function registerHealthRoute(app: FastifyInstance, deps: RouteDeps, planBytes: number): void {
  app.get(routes.people.health.path, async (request, reply) => {
    const reads = await readHealthNumbers(deps.db);
    return reply.code(200).send(toHealth(reads, deps.now(), planBytes));
  });
}
