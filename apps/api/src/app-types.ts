// The types every route folder in apps/api shares (docs/contracts.md section 4). They live apart from server.ts,
// so a route file can import them without importing the server, which would make an import cycle.
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { z } from "zod";
import type { apiEnv, Enqueue } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";

declare module "fastify" {
  interface FastifyRequest {
    // The person this request acts for, set by the session hook from the __Host-session cookie; null when no live session came (A7).
    personId: string | null;
    // The sha256 of the session token that acted for this request, set with personId; a meeting stream re-checks it (A7, invariant 21).
    sessionTokenHash: Buffer | null;
  }
}

// The api's env after apiEnv parsed it (D73, R10.2).
export type ApiEnv = z.infer<typeof apiEnv>;

// What every route plugin receives: the app_api database, the parsed env, the clock and the job queue (docs/contracts.md section 4).
export type RouteDeps = {
  db: Kysely<Database>;
  env: ApiEnv;
  now: () => Date;
  enqueue: Enqueue;
};

// One feature's routes. server.ts calls it as await registerXRoutes(app, deps) on the root instance, never through
// app.register, so the session hook and request.personId apply to every route the same way (seams S2).
export type RoutePlugin = (app: FastifyInstance, deps: RouteDeps) => Promise<void>;

// The job queue types, re-exported from contracts, so a route folder takes all its shared types from this one file.
export type { Enqueue, JobPayload } from "@meet-first/contracts";
