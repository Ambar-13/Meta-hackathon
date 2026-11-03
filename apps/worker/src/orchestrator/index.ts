// The orchestrator task for apps/worker/src/runner.ts: orchestrate plans one chat reply.
import type { TaskList } from "../job-context.js";
import { orchestrate } from "./orchestrate-job.js";

// The orchestrate job for the runner's task list (the orchestratorTasks slot of runner.ts).
export const orchestratorTasks: TaskList = { orchestrate };
// The job itself, for the tests and the golden path.
export { orchestrate } from "./orchestrate-job.js";
// The request builders and the checks, so a fixture writer builds exactly the bodies the job sends.
export { checkPlan, planCallArgs, planMessages, planUserText, type PlanInput } from "./plan-requests.js";
