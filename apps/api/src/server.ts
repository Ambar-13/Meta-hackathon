import { pathToFileURL } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import { makeWorkerUtils } from "graphile-worker";
import type { LoggerOptions } from "pino";
import { apiEnv, ContractError } from "@meet-first/contracts";
import { makeDatabase } from "@meet-first/db";
import type { ApiEnv, RouteDeps, RoutePlugin } from "./app-types.js";
import { makeApiEnqueue } from "./job-queue.js";
import { handleNotFound, handleRouteError, replaceJsonParser } from "./route-errors.js";
import { addOriginCheck, addSessionHook, registerAccountRateLimit, registerSessionsRoutes } from "./sessions/index.js";
import { registerPairsRoutes } from "./pairs/index.js";
import { registerMeetingStreamRoutes } from "./meeting-stream/index.js";
import { addContentSecurityPolicy, registerWebPagesRoutes } from "./web-pages/index.js";

// Connections in the api's Kysely pool (D56: api 10). The LISTEN connection is one more client, owned by meeting-stream.
export const API_POOL_SIZE = 10;
// Fastify's default body limit, written out (D4): 1 MiB for every JSON route. POST /api/sources sets its own route limit of UPLOAD_BODY_LIMIT_BYTES.
export const JSON_BODY_LIMIT_BYTES = 1_048_576;
// The address the server listens on: every interface, because Render's proxy reaches the container from outside it [confirm] (unverified, ARCHITECTURE.md section 12).
export const LISTEN_HOST = "0.0.0.0";
// Log fields that could carry a secret; pino replaces their values before a line is written (A7, invariant 21) [confirm] (no input lists the fields).
export const LOG_REDACT_PATHS: string[] = ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.token", "*.sessionToken", "*.recoveryCode"];
// The text that replaces a hidden log value [confirm] (no input names it).
export const LOG_REDACT_CENSOR = "[hidden]";

// What buildApp registers: every slot in order ("all"), or the given route plugins in the given order (tests).
export type BuildAppOptions = { routes: RoutePlugin[] | "all"; logStream?: NodeJS.WritableStream };

// Parses the api's env with the contracts schema; a missing or bad name stops boot with every bad name listed (R10.2, D73).
export function readApiEnv(processEnv: NodeJS.ProcessEnv): ApiEnv {
  const parsed = apiEnv.safeParse(processEnv);
  if (parsed.success) {
    return parsed.data;
  }
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "env")))].sort((a, b) => a.localeCompare(b));
  throw new ContractError("api_env_invalid", "Set " + names.join(", ") + " in the environment, then start the api again.", 500);
}

// The pino options for Fastify's logger: the env's level, the redaction above, and a test stream when one is given.
export function loggerOptions(level: ApiEnv["LOG_LEVEL"], logStream?: NodeJS.WritableStream): LoggerOptions & { stream?: NodeJS.WritableStream } {
  return {
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR },
    ...(logStream === undefined ? {} : { stream: logStream }),
  };
}

// Builds the app: logger, body limit, JSON parser, hooks, error and not-found handlers, then the routes.
export async function buildApp(deps: RouteDeps, options: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({ logger: loggerOptions(deps.env.LOG_LEVEL, options.logStream), trustProxy: true, bodyLimit: JSON_BODY_LIMIT_BYTES });
  replaceJsonParser(app);
  addContentSecurityPolicy(app);
  addOriginCheck(app, deps.env.APP_ORIGIN);
  await addSessionHook(app, deps);
  await registerAccountRateLimit(app);
  app.setErrorHandler(handleRouteError);
  app.setNotFoundHandler(handleNotFound);
  if (options.routes === "all") {
    await registerAllRoutes(app, deps);
  } else {
    for (const plugin of options.routes) {
      await plugin(app, deps);
    }
  }
  return app;
}

// Registers every feature's routes on the root instance in the fixed slot order; a missing feature keeps its slot comment until its builder's request lands (seams S2).
export async function registerAllRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await registerSessionsRoutes(app, deps);
  // slot 2: registerSourcesRoutes from "./sources/index.js", added by ingest through a request
  // slot 3: registerCardsRoutes from "./cards/index.js", added by dossier through a request
  // slot 4: registerQuizRoutes from "./quizzes/index.js", added by quiz through a request
  await registerPairsRoutes(app, deps);
  // slot 6: registerMeetingsRoutes from "./meetings/index.js", added by meeting-engine through a request
  await registerMeetingStreamRoutes(app, deps);
  // slot 8: registerBriefsRoutes from "./briefs/index.js", added by briefs through a request
  // slot 9: registerComicsRoutes from "./comics/index.js", added by comic through a request
  // slot 10: registerShareRoutes from "./share/index.js", added by share-and-consent through a request
  await registerWebPagesRoutes(app, deps);
}

// Boots the api: env, database, job queue, app, listen; SIGTERM or SIGINT ends the streams, closes the server and the pools, then exits 0.
export async function startServer(processEnv: NodeJS.ProcessEnv): Promise<void> {
  try {
    const env = readApiEnv(processEnv);
    const db = makeDatabase(env.DATABASE_URL_API, API_POOL_SIZE);
    const workerUtils = await makeWorkerUtils({ connectionString: env.DATABASE_URL_API });
    const app = await buildApp({ db, env, now: () => new Date(), enqueue: makeApiEnqueue(workerUtils) }, { routes: "all" });
    await app.listen({ port: env.PORT, host: LISTEN_HOST });
    let isStopping = false;
    const stop = async (): Promise<void> => {
      if (isStopping) return;
      isStopping = true;
      await app.close();
      await workerUtils.release();
      await db.destroy();
      process.exit(0);
    };
    process.once("SIGTERM", () => void stop());
    process.once("SIGINT", () => void stop());
  } catch (error) {
    const line = error instanceof ContractError ? error.code + ": " + error.message : "api_boot_failed: " + String(error) + ". Check DATABASE_URL_API and that pnpm db:migrate ran.";
    process.stderr.write(line + "\n");
    process.exit(1);
  }
}

// Starts the api when this file is the process entry (pnpm --filter @meet-first/api start); importing it for tests starts nothing.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void startServer(process.env);
}
