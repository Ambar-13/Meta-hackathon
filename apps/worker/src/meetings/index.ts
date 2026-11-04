// The meeting jobs as one task list for apps/worker/src/runner.ts, slot 3 (without ask_timeout
// since ask my human was dropped).
import type { TaskList } from "../job-context.js";
import { runCheckQuestion } from "./check-question-job.js";
import { runMeetingStep } from "./step-job.js";
import { runSweepStalled } from "./sweep-stalled-job.js";

// The meeting jobs for the runner's task list: one persona turn, the sweep and the question check.
export const meetingTasks: TaskList = {
  meeting_step: runMeetingStep,
  sweep_stalled: runSweepStalled,
  check_question: runCheckQuestion,
};
// The one event writer of the meeting log, for any later worker folder that appends meeting events
// (one home per rule).
export { appendMeetingEvent } from "./commit-turn.js";
