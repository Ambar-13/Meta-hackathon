import { pino } from "pino";
import type { Kysely } from "kysely";
import { ContractError, type Enqueue, JobPayloads, type JobName } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import { makeLlmClient, type LiveCaller } from "@meet-first/llm";
import { SCRIPTED_REPLIES_DIR, testWorkerEnv } from "@meet-first/llm/testing";
import type { JobContext, JobTask } from "../job-context.js";
import { TASKS } from "../runner.js";

// One job a test context was asked to enqueue.
export type EnqueuedJob = { name: JobName; payload: unknown; options: { runAt?: Date } | undefined };

// Runs one task of the merged task list inline, with the real database and no Graphile (docs/contracts.md section 4).
export async function runJobOnce(context: JobContext, name: JobName, payload: unknown): Promise<void> {
  const task = TASKS[name] as JobTask<JobName> | undefined;
  if (task === undefined) throw new ContractError("task_missing", "No task is registered for this job name. Check the slot block in runner.ts.", 500);
  const parsed = JobPayloads[name].parse(payload) as Parameters<JobTask<JobName>>[0];
  await task(parsed, context);
}

// A job context for tests: the real client over the scripted replies, a recording enqueue, a silent log. With live, the mode is live and the live caller is that fake.
export function makeTestJobContext(options: { db: Kysely<Database>; now?: () => Date; live?: LiveCaller; timeoutSignal?: (ms: number) => AbortSignal }): { context: JobContext; enqueued: EnqueuedJob[] } {
  const env = testWorkerEnv(options.live === undefined ? "replay" : "live");
  const now = options.now ?? (() => new Date());
  const llm = makeLlmClient({
    db: options.db,
    env,
    now,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    fixtureRoot: SCRIPTED_REPLIES_DIR,
    ...(options.live === undefined ? {} : { live: options.live }),
    ...(options.timeoutSignal === undefined ? {} : { timeoutSignal: options.timeoutSignal }),
  });
  const enqueued: EnqueuedJob[] = [];
  const enqueue: Enqueue = (name, payload, enqueueOptions) => {
    enqueued.push({ name, payload, options: enqueueOptions });
    return Promise.resolve();
  };
  const log = pino({ level: "silent" });
  return { context: { db: options.db, env, now, enqueue, llm, log }, enqueued };
}
