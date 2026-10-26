import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { WorkerUtils } from "graphile-worker";
import type { z } from "zod";
import { ContractError, JOB_MAX_ATTEMPTS, JobPayloads, workerEnv, type Enqueue, type JobName, type JobPayload } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import { LimiterBusy, makeLlmClient, reenqueueAfterLimiter, type LlmClient } from "@meet-first/llm";

// The worker's variables, read with the contracts schema.
export type WorkerEnv = z.infer<typeof workerEnv>;
// Everything a job may touch, built once at boot and handed to every task (docs/contracts.md section 4).
export type JobContext = { db: Kysely<Database>; env: WorkerEnv; now: () => Date; enqueue: Enqueue; llm: LlmClient; log: Logger };
// One job: a plain function of its payload and the context, never a factory (seams S3).
export type JobTask<N extends JobName> = (payload: JobPayload<N>, context: JobContext) => Promise<void>;
// The tasks of one worker feature folder, keyed by job name (seams S3).
export type TaskList = { [N in JobName]?: JobTask<N> };

// Everything a job may touch, built once at boot (docs/contracts.md section 4).
export function makeJobContext(deps: { db: Kysely<Database>; env: WorkerEnv; workerUtils: WorkerUtils; now?: () => Date; log: Logger }): JobContext {
  const now = deps.now ?? (() => new Date());
  const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return { db: deps.db, env: deps.env, now, log: deps.log, enqueue: makeEnqueue(deps.workerUtils), llm: makeLlmClient({ db: deps.db, env: deps.env, now, sleep, random: Math.random }) };
}

// Wraps a Graphile task so the payload is parsed with its zod schema before the job sees it; a bad payload fails permanently, not after 25 retries.
export function definePayloadTask<N extends JobName>(name: N, task: JobTask<N>, context: JobContext): (rawPayload: unknown) => Promise<void> {
  return async (rawPayload) => {
    const parsed = JobPayloads[name].safeParse(rawPayload);
    if (!parsed.success) {
      context.log.error({ job: name, issues: parsed.error.issues }, "job_payload_invalid");
      return;
    }
    const payload = parsed.data as JobPayload<N>;
    try {
      await task(payload, context);
    } catch (error) {
      if (!(error instanceof LimiterBusy)) throw error;
      context.log.warn({ job: name }, "limiter_busy: the job runs again in 5 s");
      await reenqueueAfterLimiter(context, name, payload);
    }
  };
}

// The enqueue every job uses; always passes JOB_MAX_ATTEMPTS[name], and never a job key (D45, IMPLEMENTATION.md 2.3).
export function makeEnqueue(workerUtils: WorkerUtils): Enqueue {
  return async (name, payload, options) => {
    const spec = {
      maxAttempts: JOB_MAX_ATTEMPTS[name],
      ...(options?.runAt === undefined ? {} : { runAt: options.runAt }),
    };
    const identifier: string = name;
    const job: unknown = await workerUtils.addJob(identifier, payload, spec);
    if (job === null || job === undefined) throw new ContractError("enqueue_failed", "The job queue did not accept the job. Retry the request.");
  };
}
