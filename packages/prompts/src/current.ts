// The version folder each prompt sends today. Only the wave's prompts owner edits this file: dossier in Wave 1, briefs in Wave 2 (IMPLEMENTATION.md section 8).
export const CURRENT_PROMPTS = {
  dossier: "v1",
  "scrub-names": "v1",
  "question-check": "v2",
  "quiz-persona-answer": "v1",
  "quiz-judge": "v1",
  "meeting-moderator": "v2",
  "meeting-speech": "v2",
  "meeting-receipts": "v1",
  brief: "v2",
  "brief-support-judge": "v1",
  "comic-panels": "v1",
  "comic-image": "v1",
  "untrusted-data-rules": "v1",
} as const;
// The name of one prompt folder under packages/prompts.
export type PromptName = keyof typeof CURRENT_PROMPTS;
// Every prompt folder name, in the order of IMPLEMENTATION.md section 2.5.
export const PROMPT_NAMES = Object.keys(CURRENT_PROMPTS) as PromptName[];
// The version folder the code reads for one prompt, such as "v1".
export function currentVersion(name: PromptName): string {
  return CURRENT_PROMPTS[name];
}
