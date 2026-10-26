// The comic job as one task list for apps/worker/src/runner.ts, slot 5 (seams S3): six panels, all or nothing.
import type { TaskList } from "../job-context.js";
import { renderComicTask } from "./render-comic-job.js";

// The comic tasks for the worker task list: the render_comic job.
export const comicTasks: TaskList = { render_comic: renderComicTask };
// The job's constants, its skip reasons and its task, for the golden path and the tests.
export { COMIC_DEADLINE_MS, PANEL_COUNT, renderComicTask, type SkipReason, checkPromptsWithScrubber } from "./render-comic-job.js";
// The headline pick, the prompt builders and the style prefix, shared with the tests and the golden path.
export { buildImagePrompts, HEADLINES_MAX, pickHeadlines, STYLE_PREFIX } from "./panel-prompts.js";
// The image calls and the webp encoder under the cap, shared with the tests and the golden path.
export { encodePanelWebp, renderPanels } from "./image-calls.js";
