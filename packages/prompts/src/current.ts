// The version folder each prompt sends today.
export const CURRENT_PROMPTS = {
  dossier: "v1",
  "scrub-names": "v1",
  "question-check": "v5",
  "quiz-persona-answer": "v1",
  "quiz-judge": "v1",
  "meeting-moderator": "v5",
  "meeting-speech": "v2",
  "meeting-receipts": "v1",
  brief: "v5",
  "brief-support-judge": "v2",
  "comic-panels": "v1",
  "comic-image": "v1",
  "untrusted-data-rules": "v1",
  "persona-answer": "v1",
  orchestrator: "v3",
  "summary-request": "v1",
} as const;
// The name of one prompt folder under packages/prompts.
export type PromptName = keyof typeof CURRENT_PROMPTS;
// Every prompt folder name.
export const PROMPT_NAMES = Object.keys(CURRENT_PROMPTS) as PromptName[];
// The version folder the code reads for one prompt, such as "v1".
export function currentVersion(name: PromptName): string {
  return CURRENT_PROMPTS[name];
}
