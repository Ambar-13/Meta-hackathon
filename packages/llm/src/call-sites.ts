import { type CallSite, type Effort } from "@meet-first/contracts";

// The settings of one call site: effort, output limit, timeouts, retries, prompt folder and output shape.
export type CallSiteConfig = {
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
  firstTokenMs?: number;
  retries: number;
  prompt: string | null;
  temperature?: 0;
  structured: boolean;
  streams: boolean;
};
// The settings of every call site, from the ARCHITECTURE.md section 8 table. Values marked [confirm] are builder defaults.
// Muse Spark reasons inside max_tokens even at effort minimal, so a tight limit cuts the reply and the length retry redoes it at minimal
// effort. Measured on the live API on 27 Oct 2026: the question check used 188 of 200 tokens reasoning, the brief support judge 1,821
// of 2,000, and the brief 3,860 of 4,000 at effort medium; each was cut. The limits of question_check, quiz_judge, brief, both judges,
// comic_panels and persona_answer were raised to leave room; a limit is a ceiling, so a reply costs only the tokens it uses.
export const CALL_SITE_CONFIG: Record<CallSite, CallSiteConfig> = {
  scrub_names: { effort: "minimal", maxTokens: 4_000 /* [confirm] */, timeoutMs: 60_000, retries: 1, prompt: "scrub-names", structured: true, streams: false }, // D15
  question_check: { effort: "minimal", maxTokens: 2_000, timeoutMs: 30_000, retries: 1, prompt: "question-check", structured: true, streams: false }, // R10.5
  card: { effort: "medium", maxTokens: 16_000, timeoutMs: 240_000, retries: 1, prompt: "dossier", structured: true, streams: false }, // D22
  quiz_answer: { effort: "low", maxTokens: 2_000 /* [confirm] */, timeoutMs: 60_000 /* [confirm] */, retries: 1, prompt: "quiz-persona-answer", structured: true, streams: false },
  quiz_judge: { effort: "minimal", maxTokens: 2_000, timeoutMs: 30_000, retries: 1, prompt: "quiz-judge", temperature: 0, structured: true, streams: false }, // D30
  // D39 set 20 s and 90 s. On the live API on 27 Oct 2026 a speech call at effort low (11,048 input tokens) sent its first content at 10.2 s,
  // because Muse Spark streams nothing while it reasons, so the first-token gate is 45 s and the whole call 120 s.
  speech: { effort: "low", maxTokens: 6_000, timeoutMs: 120_000, firstTokenMs: 45_000, retries: 1, prompt: "meeting-speech", structured: false, streams: true }, // D39
  receipts: { effort: "minimal", maxTokens: 2_000, timeoutMs: 30_000, retries: 1, prompt: "meeting-receipts", structured: true, streams: false }, // D39, D27
  brief: { effort: "medium", maxTokens: 16_000, timeoutMs: 120_000 /* [confirm] */, retries: 1, prompt: "brief", structured: true, streams: false },
  brief_support_judge: { effort: "minimal", maxTokens: 8_000, timeoutMs: 30_000, retries: 1, prompt: "brief-support-judge", temperature: 0, structured: true, streams: false }, // A1
  comic_panels: { effort: "low", maxTokens: 6_000, timeoutMs: 60_000 /* [confirm] */, retries: 1, prompt: "comic-panels", structured: true, streams: false },
  comic_image: { effort: "minimal", maxTokens: 0, timeoutMs: 30_000, retries: 0, prompt: "comic-image", structured: false, streams: false }, // D64; effort is a ledger placeholder for an image call
  self_test: { effort: "minimal", maxTokens: 1, timeoutMs: 30_000, retries: 0, prompt: null, structured: true, streams: false }, // R3.1
  persona_answer: { effort: "low", maxTokens: 4_000, timeoutMs: 60_000 /* [confirm] */, retries: 1, prompt: "persona-answer", structured: true, streams: false }, // as-built 49; with 20 calls per help search this bounds one search's spend at 80,000 output tokens
  ask_support_judge: { effort: "minimal", maxTokens: 8_000, timeoutMs: 30_000, retries: 1, prompt: "brief-support-judge", temperature: 0, structured: true, streams: false }, // as-built 49: the brief support check, reused on answer claims
  orchestrator: { effort: "low", maxTokens: 4_000 /* [confirm] */, timeoutMs: 60_000, retries: 1, prompt: "orchestrator", structured: true, streams: false }, // wave 7: one plan per chat message, room for Muse Spark to reason before a short JSON
};
// Ledger estimate for one image call, in tokens (R11.4).
export const IMAGE_CALL_EST_TOKENS = 1_000;
// The retry settings for a reply that stopped at the length limit: minimal effort and at least 8,000 tokens (D63).
export const LENGTH_RETRY = { effort: "minimal", maxTokens: 8_000 } as const;
// The length retry of one call site: minimal effort and the larger of 8,000 and the call site's own maxTokens, so a cut card (16,000) is
// not retried with half the room it was cut with (D63).
export function lengthRetryFor(callSite: CallSite): { effort: Effort; maxTokens: number } {
  return { effort: LENGTH_RETRY.effort, maxTokens: Math.max(LENGTH_RETRY.maxTokens, CALL_SITE_CONFIG[callSite].maxTokens) };
}
