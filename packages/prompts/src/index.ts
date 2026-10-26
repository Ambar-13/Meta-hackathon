// The prompt reader: reads the current version of one prompt at call time.
export { readPrompt, promptFilePath, PROMPTS_ROOT } from "./read-prompt.js";
// The version folder each prompt sends today, and the names of the prompt folders.
export { CURRENT_PROMPTS, PROMPT_NAMES, currentVersion } from "./current.js";
// The shape of one prompt as the code reads it.
export type { Prompt } from "./read-prompt.js";
// The name of one prompt folder.
export type { PromptName } from "./current.js";
