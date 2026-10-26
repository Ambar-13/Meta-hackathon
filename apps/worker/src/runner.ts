import { pathToFileURL } from "node:url";
import { pino } from "pino";
import { makeWorkerUtils, run, type Runner, type Task } from "graphile-worker";
import { ZodError } from "zod";
import { ContractError, CRONTAB, JOB_NAMES, WORKER_CONCURRENCY, workerEnv } from "@meet-first/contracts";
import { assertSchemaVersion, makeDatabase, POOL_SIZE, SCHEMA_VERSION } from "@meet-first/db";
import { assertWorkerModeAllowed, runBootSelfTest, selfTestExitCode } from "@meet-first/llm";
import { definePayloadTask, makeJobContext, type JobContext, type JobTask, type TaskList } from "./job-context.js";
import { briefTasks } from "./briefs/index.js";
import { cardTasks } from "./cards/index.js";
import { comicTasks } from "./comics/index.js";
import { meetingTasks } from "./meetings/index.js";
import { quizTasks } from "./quizzes/index.js";
import { retentionTasks } from "./retention/index.js";
import { askTasks } from "./asks/index.js";

// Every task the worker runs, one spread per feature folder, in slot order (seams S3).
export const TASKS: TaskList = {
  ...cardTasks,
  ...quizTasks,
  ...meetingTasks,
  ...briefTasks,
  ...comicTasks,
  ...retentionTasks,
  ...askTasks,
};

// Wraps every task of the list for Graphile, in JOB_NAMES order, so each payload is parsed before its job runs.
export function graphileTaskList(tasks: TaskList, context: JobContext): Record<string, Task> {
  const list: Record<string, Task> = {};
  for (const name of JOB_NAMES) {
    const task = tasks[name] as JobTask<typeof name> | undefined;
    if (task !== undefined) list[name] = definePayloadTask(name, task, context);
  }
  return list;
}

// The crontab lines of contracts whose task is in the list, so a cron never names a task that is not registered yet (D46).
export function crontabForTasks(tasks: TaskList): string {
  return CRONTAB.split("\n")
    .filter((line) => {
      const taskName = line.trim().split(/\s+/)[5];
      return taskName !== undefined && taskName in tasks;
    })
    .join("\n");
}

// The one line printed when the worker cannot start: the env names that failed, or the error code and sentence.
export function describeBootError(error: unknown): string {
  if (error instanceof ZodError) return `env_invalid: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}`;
  if (error instanceof ContractError) return `${error.code}: ${error.message}`;
  return String(error);
}

// Boot order (D71, D74, R3.1, D57, D56): parse env, refuse replay in production, check the schema version, run the self-test, then start Graphile.
export async function startWorker(processEnv: NodeJS.ProcessEnv): Promise<Runner> {
  const env = workerEnv.parse(processEnv);
  assertWorkerModeAllowed(env, processEnv.NODE_ENV);
  const log = pino({ level: env.LOG_LEVEL });
  const db = makeDatabase(env.DATABASE_URL_WORKER, POOL_SIZE.worker);
  await assertSchemaVersion(db, SCHEMA_VERSION);
  const workerUtils = await makeWorkerUtils({ connectionString: env.DATABASE_URL_WORKER });
  const context = makeJobContext({ db, env, workerUtils, log });
  const results = await runBootSelfTest(context.llm, (line) => {
    log.info(line);
  });
  if (selfTestExitCode(results) !== 0) {
    throw new ContractError("self_test_failed", "The boot self-test refused at least one output schema. Read the self-test lines, fix the schema, and start the worker again.", 500);
  }
  return run({ connectionString: env.DATABASE_URL_WORKER, concurrency: WORKER_CONCURRENCY, crontab: crontabForTasks(TASKS), taskList: graphileTaskList(TASKS, context), pollInterval: 1000 });
}

// Starts the worker when this file is the process entry (pnpm start); importing it for tests starts nothing.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startWorker(process.env).catch((error: unknown) => {
    console.error(describeBootError(error));
    process.exit(1);
  });
}
