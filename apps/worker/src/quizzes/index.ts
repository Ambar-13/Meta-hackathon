import type { TaskList } from "../job-context.js";
import { answerQuizTask } from "./answer-quiz-job.js";
import { judgeQuizTask } from "./judge-quiz-job.js";

// The two quiz jobs for the runner's task list.
export const quizTasks: TaskList = { answer_quiz: answerQuizTask, judge_quiz: judgeQuizTask };

// The question texts the persona got wrong, for the meeting's prompt builder.
export { quizMisses } from "./calibration.js";
