// The briefs folder for the worker: the write_briefs task list, the two call settings and the score
// the evals read.
import type { TaskList } from "../job-context.js";
import { writeBriefsTask } from "./write-briefs-job.js";

// The brief jobs for the worker task list, one task per job name (runner slot 4).
export const briefTasks: TaskList = { write_briefs: writeBriefsTask };
// The brief call and the support judge call settings, as the client applies them.
export { BRIEF_CALL, SUPPORT_JUDGE_CALL } from "./write-briefs-job.js";
// The support rate of one brief, read by the evals package.
export { computeSupportRate } from "./support-judge.js";
