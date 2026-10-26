import type { TaskList } from "../job-context.js";
import { answerQuizTask } from "./answer-quiz-job.js";
import { judgeQuizTask } from "./judge-quiz-job.js";

// The two quiz jobs for the runner's task list (seams S3 slot 2; IMPLEMENTATION.md 2.3).
export const quizTasks: TaskList = { answer_quiz: answerQuizTask, judge_quiz: judgeQuizTask };

// The question texts the persona got wrong, for meeting-engine's prompt builder (seams S10).
export { quizMisses } from "./calibration.js";
