// What exists: the worker runs jobs from Graphile's queue in Postgres. Some routes start background
// work, such as a card build, a quiz, a meeting step or a deletion, and the job must exist exactly
// when the rows it reads exist. The step: a route calls deps.enqueue after its withPerson
// transaction has committed, never inside it, because the queue writes through its own connection.
// If the enqueue throws, the route undoes the rows it wrote. This file does not run jobs and does
// not retry them; the worker owns both.
import type { TaskSpec, WorkerUtils } from "graphile-worker";
import { ContractError, type Enqueue, JOB_MAX_ATTEMPTS } from "@meet-first/contracts";

// The sentence for a job Graphile did not accept.
export const ENQUEUE_FAILED_SENTENCE = "The job queue did not accept the job. Retry the request.";

// Builds the enqueue the routes use. maxAttempts is always JOB_MAX_ATTEMPTS[name]; runAt goes only
// when the caller gave one, because no job has a key any more. A null from addJob is
// enqueue_failed.
export function makeApiEnqueue(workerUtils: WorkerUtils): Enqueue {
  return async (name, payload, options) => {
    const spec: TaskSpec = {
      maxAttempts: JOB_MAX_ATTEMPTS[name],
      ...(options?.runAt === undefined ? {} : { runAt: options.runAt }),
    };
    // In words: the spec always has maxAttempts, and it has runAt only when the caller gave one.
    // Graphile types a payload from its task list, which this queue does not use, so the name is
    // passed as plain text. The payload type comes from contracts, so no local copy of it is kept
    // here.
    const identifier: string = name;
    // Graphile documents that addJob can return null under contention, so the result is read as
    // unknown and checked.
    const job: unknown = await workerUtils.addJob(identifier, payload, spec);
    if (job === null || job === undefined) {
      throw new ContractError("enqueue_failed", ENQUEUE_FAILED_SENTENCE);
    }
  };
}
