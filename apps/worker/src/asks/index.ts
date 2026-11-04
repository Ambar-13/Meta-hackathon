// The ask tasks for apps/worker/src/runner.ts: run_ask answers a help search or a friend ask.
import type { TaskList } from "../job-context.js";
import { runAsk } from "./run-ask-job.js";

// The ask job for the runner's task list, one task per job name (the askTasks slot of runner.ts).
export const askTasks: TaskList = { run_ask: runAsk };
// The run_ask job itself, for the tests and the golden path's ask writer.
export { runAsk } from "./run-ask-job.js";
// The request builders, so a fixture writer builds exactly the bodies the job sends.
export {
  askCheckCallArgs,
  askCheckMessages,
  askJudgeCallArgs,
  askJudgeMessages,
  personaAnswerCallArgs,
  personaAnswerMessages,
} from "./ask-requests.js";
