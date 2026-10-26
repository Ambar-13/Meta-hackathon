import type { TaskList } from "../job-context.js";
import { buildCardTask } from "./build-card-job.js";
import { scrubNamesTask } from "./scrub-names-job.js";

// The card jobs for the worker task list, slot 1 of seams S3: the names pass and the card build.
export const cardTasks: TaskList = { scrub_names: scrubNamesTask, build_card: buildCardTask };
// The turn label format and the names-pass request, shared with the fixture cases.
export { formatTurnBlock, TURN_BLOCK_SEPARATOR, chunkTurnsForNames, namesPassCall, type ModelCall } from "./name-chunks.js";
// The card sampler and requests, shared with the fixture cases.
export { sampleTurns, cardCall, cardRegenerationCall, type SampledTurn } from "./turn-sampler.js";
// The quote check, shared with the fixture cases.
export { verifyItems, hasEnoughOwnText, type ItemCheck, type FailedItem } from "./verify-items.js";
// The sensitive-turn filter of the card build, shared with the fixture cases.
export { eligibleTurns } from "./build-card-job.js";
