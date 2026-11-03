// The summary folder: the check_summary job, which replaces names in a person's pasted summary and finds each point's quotes.
import type { TaskList } from "../job-context.js";
import { checkSummaryTask } from "./check-summary-job.js";

// The summary jobs for the worker task list.
export const summaryTasks: TaskList = { check_summary: checkSummaryTask };
// Where each of a summary's quotes stands in the person's own messages.
export { findQuoteTurns } from "./find-quotes.js";
