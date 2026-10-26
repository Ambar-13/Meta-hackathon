// The support check of an ask's verified claims and the answers' places (design section 4 steps 5 and 6, A1). The check reads each claim
// and its quote, blind to whose they are, in the brief check's format; the places only order the help results and are never shown as a number.
import { ASK_JUDGE_ITEMS_MAX, ContractError, type JobPayload } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { LimiterBusy, reenqueueAfterLimiter } from "@meet-first/llm";
import { readPrompt, type Prompt } from "@meet-first/prompts";
import { z } from "zod";
import type { JobContext } from "../job-context.js";
import { askJudgeCallArgs, askJudgeMessages, type JudgeClaim, type StoredAnswerClaim } from "./ask-requests.js";
import { lockAsk, moveAsk, readAnswers, writeClaims, writePlacement, type AnswerRow, type AskRow } from "./ask-store.js";

// One verified claim in the check: the answer and claim index it belongs to, what the judge reads, and its stored verdict.
export type ClaimRef = { answerId: string; claimIndex: number; claim: JudgeClaim; supported: boolean | null };
// One answer as the places read it.
export type PlaceInput = { id: string; shortlistRank: number; hasSign: boolean; supportedCount: number };
// One chunk's check, with its ask and the judge prompt.
type ChunkScope = { ask: AskRow; chunk: readonly ClaimRef[]; prompt: Prompt };

// One support-check reply in the brief judge's shape without its count of nine; the chunk's own count replaces it below (A1).
const JudgeReply = z.object({ lines: z.array(z.object({ index: z.number().int().min(0), supported: z.boolean(), reason: z.string().min(1).max(200) })) });

// The verified claims of the answered rows, by shortlist rank and then claim order, in chunks of at most ASK_JUDGE_ITEMS_MAX (30).
// A help search has at most 20 answers of at most 3 claims, so at most 2 chunks (design section 4 step 5).
export function judgeChunks(answers: readonly AnswerRow[]): ClaimRef[][] {
  const ordered = [...answers].sort((left, right) => left.shortlistRank - right.shortlistRank);
  const refs: ClaimRef[] = ordered.flatMap((row) => row.claims.flatMap((claim, claimIndex) => (
    claim.verified && claim.turnId !== null ? [{ answerId: row.id, claimIndex, claim: { text: claim.text, quote: claim.quote, turnId: claim.turnId }, supported: claim.supported }] : []
  )));
  const chunks: ClaimRef[][] = [];
  for (let start = 0; start < refs.length; start += ASK_JUDGE_ITEMS_MAX) chunks.push(refs.slice(start, start + ASK_JUDGE_ITEMS_MAX));
  return chunks;
}

// The verdicts of one reply for a chunk of count claims, by index: exactly count lines, each index from 0 to count - 1 once [confirm].
// Anything else is null, a failed check, so the chunk's claims keep supported null (A1).
export function readJudgeVerdicts(reply: unknown, count: number): boolean[] | null {
  const parsed = JudgeReply.safeParse(reply);
  if (!parsed.success || parsed.data.lines.length !== count) return null;
  const byIndex = new Map<number, boolean>(parsed.data.lines.map((line): [number, boolean] => [line.index, line.supported]));
  const verdicts: boolean[] = [];
  for (let index = 0; index < count; index += 1) {
    const isSupported = byIndex.get(index);
    if (isSupported === undefined) return null;
    verdicts.push(isSupported);
  }
  return verdicts;
}

// Every answer the chunk touches, with its full claims list and the chunk's verdicts written in, by answer id. The rows given are not changed.
export function applyVerdicts(answers: readonly AnswerRow[], chunk: readonly ClaimRef[], verdicts: readonly boolean[]): Map<string, StoredAnswerClaim[]> {
  const touched = new Map<string, StoredAnswerClaim[]>();
  chunk.forEach((ref, index) => {
    const row = answers.find((candidate) => candidate.id === ref.answerId);
    const isSupported = verdicts[index];
    if (row === undefined || isSupported === undefined) return;
    const claims = touched.get(ref.answerId) ?? row.claims.map((claim) => ({ ...claim }));
    const claim = claims[ref.claimIndex];
    if (claim !== undefined) claim.supported = isSupported;
    touched.set(ref.answerId, claims);
  });
  return touched;
}

// Claims whose quote was found and that the check did not turn down: supported true, or null when the check did not run, so a failed
// check counts every verified claim (design section 4 step 5) [confirm].
export function supportedCount(claims: readonly StoredAnswerClaim[]): number {
  return claims.filter((claim) => claim.verified && claim.supported !== false).length;
}

// The places of the results: answers with a sign and at least one supported claim, most supported claims first and then by shortlist
// rank, get 1, 2, 3 and so on; every other answer gets null (design section 4 step 6).
export function placeAnswers(rows: readonly PlaceInput[]): Map<string, number | null> {
  const places = new Map<string, number | null>(rows.map((row): [string, number | null] => [row.id, null]));
  const placed = rows.filter((row) => row.hasSign && row.supportedCount >= 1)
    .sort((left, right) => right.supportedCount - left.supportedCount || left.shortlistRank - right.shortlistRank);
  placed.forEach((row, index) => {
    places.set(row.id, index + 1);
  });
  return places;
}

// Design steps 5 and 6: one support check per chunk not judged yet, then the supported counts, the places and done. A full token window
// re-queues the job and keeps every verdict already written [confirm]; any other failure of a chunk leaves its claims unchecked, and the job goes on (A1).
export async function rankAnswers(context: JobContext, payload: JobPayload<"run_ask">, ask: AskRow): Promise<void> {
  const prompt = readPrompt("brief-support-judge");
  const answers = await withPerson(context.db, ask.personId, (trx) => readAnswers(trx, ask.id, "answered"));
  for (const chunk of judgeChunks(answers)) {
    if (chunk.every((ref) => ref.supported !== null)) continue;
    const verdicts = await judgeChunk(context, { ask, chunk, prompt });
    if (verdicts === "limited") {
      await reenqueueAfterLimiter(context, "run_ask", payload);
      return;
    }
    if (verdicts !== null) await saveVerdicts(context, { ask, chunk, prompt }, verdicts);
  }
  await finishRanking(context, ask);
}

// One support-check call for one chunk: its verdicts, null when the call or its reply failed, or "limited" for a full token window.
async function judgeChunk(context: JobContext, scope: ChunkScope): Promise<boolean[] | null | "limited"> {
  const claims = scope.chunk.map((ref) => ref.claim);
  try {
    const result = await context.llm.complete(askJudgeCallArgs({ askerId: scope.ask.personId, promptVersion: scope.prompt.version, messages: askJudgeMessages(scope.prompt.text, claims) }));
    const verdicts = readJudgeVerdicts(result.parsed, claims.length);
    if (verdicts === null) context.log.warn({ code: "ask_judge_reply_invalid", askId: scope.ask.id }, "The support check reply did not cover each claim once, so these claims stay unchecked.");
    return verdicts;
  } catch (error) {
    if (error instanceof LimiterBusy) return "limited";
    const code = error instanceof ContractError ? error.code : "ask_judge_failed";
    context.log.warn({ code, askId: scope.ask.id }, "The support check call failed, so these claims stay unchecked.");
    return null;
  }
}

// Writes one chunk's verdicts into the claims of the answers it touches, in the asker's context.
async function saveVerdicts(context: JobContext, scope: ChunkScope, verdicts: readonly boolean[]): Promise<void> {
  await withPerson(context.db, scope.ask.personId, async (trx) => {
    const answers = await readAnswers(trx, scope.ask.id, "answered");
    for (const [answerId, claims] of applyVerdicts(answers, scope.chunk, verdicts)) await writeClaims(trx, answerId, claims);
  });
}

// Design step 6, in one transaction under a lock on the ask: each answered row's supported count and place, then the ask is done.
// A run that finds the ask already past ranking writes nothing.
async function finishRanking(context: JobContext, ask: AskRow): Promise<void> {
  await withPerson(context.db, ask.personId, async (trx) => {
    if ((await lockAsk(trx, ask.id)) !== "ranking") return;
    const answers = await readAnswers(trx, ask.id, "answered");
    const counts = new Map<string, number>(answers.map((row): [string, number] => [row.id, supportedCount(row.claims)]));
    const places = placeAnswers(answers.map((row) => ({ id: row.id, shortlistRank: row.shortlistRank, hasSign: row.hasSign === true, supportedCount: counts.get(row.id) ?? 0 })));
    for (const row of answers) await writePlacement(trx, { answerId: row.id, supportedCount: counts.get(row.id) ?? 0, position: places.get(row.id) ?? null });
    await moveAsk(trx, { askId: ask.id, from: "ranking", to: "done", now: context.now() });
  });
}
