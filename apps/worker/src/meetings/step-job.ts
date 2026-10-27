import { sql, type Kysely, type Transaction } from "kysely";
import { CLAIMS_PER_TURN_MAX, ContractError, recallResult, rowToEvent, type CommittedEvent, type JobPayload, type ToolDefinition } from "@meet-first/contracts";
import { withMeeting, type Database } from "@meet-first/db";
import { CapReached, DEFAULT_CHARS_PER_TOKEN, LimiterBusy, readMeetingTokens, reenqueueAfterLimiter, type ChatMessage } from "@meet-first/llm";
import { readPrompt, type PromptName } from "@meet-first/prompts";
import type { JobContext, JobTask } from "../job-context.js";
import { isOverTokenStop } from "./agenda.js";
import { claimStep, recordFirstToken, releaseStep, saveRound, savePartialText, writePartial, type HeldRef, type StepRow } from "./claim-step.js";
import { commitTurn, endMeeting } from "./commit-turn.js";
import { assertValidHistory } from "./history-validator.js";
import { buildVariablePart, capTurns, forbiddenTexts, initialMessages, promptCacheKey, receiptsCallArgs, speechCallArgs, type LoadedPrompt, type MeetingPrompts, type PromptClaim, type PromptTurn, type VariableInput } from "./prompt-builder.js";
import { buildReceiptsMessages, runReceipts, type CitableTurn, type ReceiptsInput, type StoredClaim } from "./receipts.js";
import { runRoundTransaction, type HeldStep } from "./tool-calls.js";
import { isToolRound, joinTurnText, PartialTextWriter, runSpeechRounds, type RoundResult, type SpeakResult } from "./tool-loop.js";
import type { AssistantMessage } from "./history-validator.js";
import { isPublicOnlyCard } from "./public-items.js";

// What the begin transaction decided: nothing to do, the token stop ended the meeting, or this runner holds the step.
type BeginOutcome = { kind: "skip" } | { kind: "budget" } | { kind: "run"; plan: StepPlan };
// Everything the speech and commit phases need, read in the begin transaction.
type StepPlan = { held: HeldStep; prefix: string; question: string; base: string; hasDecision: boolean };
// The receipts of one turn: the claims to store and how many were dropped.
type ReceiptsOutcome = { claims: StoredClaim[]; droppedCount: number };
// The citable turns and the lists the receipts request shows, read in one transaction.
type ReceiptsSource = { cardQuotes: ReceiptsInput["cardQuotes"]; recallTurns: ReceiptsInput["recallTurns"]; turns: Map<number, CitableTurn> };

// The meeting_step job (ARCHITECTURE.md 4.2): claim the step, speak, check receipts, commit; a failure leaves the step pending or stalled for the sweeper (D44, D59).
export const runMeetingStep: JobTask<"meeting_step"> = async (payload, context) => {
  let held: HeldStep | null = null;
  try {
    const prompts = loadMeetingPrompts();
    const begun = await beginStep(context, payload);
    if (begun.kind === "budget") {
      await context.enqueue("write_briefs", { meetingId: payload.meetingId });
      return;
    }
    if (begun.kind === "skip") return;
    held = begun.plan.held;
    await speakAndCommit(context, begun.plan, prompts);
  } catch (error) {
    await handleStepFailure(context, payload, { held, error });
  }
};

// Reads the four prompts through readPrompt (seams S7). readPrompt is synchronous on main, so no await is needed.
export function loadMeetingPrompts(): MeetingPrompts {
  return {
    moderator: loadPrompt("meeting-moderator"),
    speech: loadPrompt("meeting-speech"),
    receipts: loadPrompt("meeting-receipts"),
    untrustedRules: loadPrompt("untrusted-data-rules"),
  };
}

// One prompt as a step uses it: its text and the version readPrompt read.
function loadPrompt(name: PromptName): LoadedPrompt {
  const prompt = readPrompt(name);
  return { text: prompt.text, version: prompt.version };
}

// The begin transaction: lock the step, check the token stop, build or reuse the messages, and store the partial text reset.
async function beginStep(context: JobContext, payload: JobPayload<"meeting_step">): Promise<BeginOutcome> {
  return withMeeting(context.db, payload.meetingId, (trx) => beginInside(trx, { context, payload, now: context.now() }));
}

// The begin steps in the order of the design, inside the begin transaction.
async function beginInside(trx: Transaction<Database>, scope: { context: JobContext; payload: JobPayload<"meeting_step">; now: Date }): Promise<BeginOutcome> {
  const { context, payload, now } = scope;
  const meeting = await trx.selectFrom("meetings").select(["state", "question_text"]).where("id", "=", payload.meetingId).executeTakeFirst();
  if (meeting === undefined || meeting.state !== "running") return { kind: "skip" };
  const claim = await claimStep(trx, payload.meetingId, payload.stepSeq);
  if (claim.kind !== "claimed") return { kind: "skip" };
  const ref = refOf(claim.step);
  const tokens = await readMeetingTokens(trx, payload.meetingId);
  if (isOverTokenStop(tokens)) {
    await releaseStep(trx, ref, "stalled");
    // A false end means another path ended the meeting first and queued its own briefs, so this runner queues none.
    const isEnded = await endMeeting(trx, { meetingId: payload.meetingId, reason: "budget", now });
    return isEnded ? { kind: "budget" } : { kind: "skip" };
  }
  const member = await trx.selectFrom("meeting_members").select(["person_id", "card_id", "frozen_prefix"]).where("meeting_id", "=", payload.meetingId).where("side", "=", claim.step.side).executeTakeFirst();
  if (member === undefined || member.frozen_prefix === null) {
    throw new ContractError("prefix_missing", "This side has no frozen prompt prefix, so its turn cannot be built. The step stays stalled.", 500);
  }
  const held: HeldStep = { meetingId: payload.meetingId, stepSeq: claim.step.stepSeq, side: claim.step.side, phase: claim.step.phase, attempt: claim.step.attempt, toolRounds: claim.step.toolRounds, personId: member.person_id, cardId: member.card_id, messages: claim.step.messages };
  if (held.messages.length === 0) {
    held.messages = await firstMessages(trx, { context, held, prefix: member.frozen_prefix });
    await saveRound(trx, held, { messages: held.messages, toolRounds: 0 });
  }
  const hasDecision = await hasDecisionEvent(trx, held);
  const base = joinTurnText(held.messages, "");
  await resetPartialText(trx, ref, base);
  return { kind: "run", plan: { held, prefix: member.frozen_prefix, question: meeting.question_text, base, hasDecision } };
}

// The first messages of a step: the frozen prefix and the variable part, capped to the request size (D40).
async function firstMessages(trx: Transaction<Database>, scope: { context: JobContext; held: HeldStep; prefix: string }): Promise<ChatMessage[]> {
  const { context, held, prefix } = scope;
  const turns = await committedTurns(trx, held.meetingId);
  const otherClaims = await otherSideClaims(trx, held);
  const input: VariableInput = { stepSeq: held.stepSeq, side: held.side, phase: held.phase, turns, droppedTurns: 0, otherClaims };
  const capped = capTurns(prefix, input, DEFAULT_CHARS_PER_TOKEN);
  if (capped.isOverCap) context.log.warn({ code: "prompt_over_cap", meetingId: held.meetingId, stepSeq: held.stepSeq }, "The request is still over its size cap and is sent anyway.");
  return initialMessages(prefix, buildVariablePart(capped.input));
}

// Resets the attempt's partial text to the saved base and tells the viewers to replace the old partial (seams S9).
async function resetPartialText(trx: Transaction<Database>, ref: HeldRef, base: string): Promise<void> {
  await savePartialText(trx, ref, base);
  await sql`SELECT pg_notify('meeting_events', ${"d:" + ref.meetingId + ":" + String(ref.stepSeq) + ":" + String(ref.attempt) + ":" + String(base.length)})`.execute(trx);
}

// The speech rounds, the receipts and the commit, after the begin transaction has committed.
async function speakAndCommit(context: JobContext, plan: StepPlan, prompts: MeetingPrompts): Promise<void> {
  const { held } = plan;
  const writer = new PartialTextWriter({ write: (text) => writePartial(context.db, refOf(held), text), now: context.now }, plan.base, context.now());
  const scope: SpeechScope = { context, plan, prompts, writer };
  const outcome = await runSpeechRounds({ phase: held.phase, messages: held.messages, requestsMade: held.toolRounds, hasDecision: plan.hasDecision }, {
    speak: (request) => speakOnce(scope, request),
    runRound: (round) => runAndRecord(context, held, round),
    discardRound: () => writer.discardRound(),
  });
  const receipts = await checkReceipts(context, { plan, prompts, speechText: outcome.text });
  if (receipts.droppedCount > 0) context.log.warn({ code: "claim_turn_unknown", count: receipts.droppedCount, meetingId: held.meetingId, stepSeq: held.stepSeq }, "Claims that named a turn outside the lists were dropped.");
  await commitTurn(context, {
    meetingId: held.meetingId, stepSeq: held.stepSeq, side: held.side, phase: held.phase, attempt: held.attempt, personId: held.personId, cardId: held.cardId,
    text: outcome.text, requestsMade: outcome.requestsMade, hasDecision: outcome.hasDecision, claims: receipts.claims.slice(0, CLAIMS_PER_TURN_MAX), toolCalls: toolCallsOf(held.messages),
  });
}

// One speech request: the history check, the streamed call, the flush of its text and, for a side's first turn, the measured prompt size.
async function speakOnce(scope: SpeechScope, request: { messages: ChatMessage[]; tools: ToolDefinition[] | undefined; round: number }): Promise<SpeakResult> {
  const { context, plan, prompts, writer } = scope;
  assertValidHistory(request.messages);
  const { held } = plan;
  const result = await context.llm.stream({
    ...speechCallArgs({ meetingId: held.meetingId, promptVersion: prompts.speech.version, messages: request.messages, tools: request.tools, cacheKey: promptCacheKey(plan.prefix, held.side) }),
    onDelta: (slice) => writer.append(slice),
    onFirstToken: () => recordFirstToken(context.db, refOf(held), context.now()),
  });
  const spoken: SpeakResult = { text: result.text ?? "", toolCalls: result.toolCalls, finishReason: result.finishReason };
  // A round that called a tool is not part of the turn, so the words it streamed leave the screen as it ends (W3-SPEECH-T1).
  if (isToolRound(spoken, request.tools)) await writer.discardRound();
  else await writer.flush();
  writer.endRound();
  if (request.round === 1 && held.stepSeq <= 2) await storeMeasuredTokens(context, held, result.usage.promptTokens);
  return spoken;
}

// Runs one round's tool calls and keeps the step's messages in memory, so the commit sees every round.
async function runAndRecord(context: JobContext, held: HeldStep, round: { messages: ChatMessage[]; assistant: AssistantMessage; round: number }): Promise<RoundResult> {
  const outcome = await runRoundTransaction(context, held, round);
  held.messages = [...round.messages, round.assistant, ...outcome.toolMessages];
  held.toolRounds = round.round;
  return outcome;
}

// Replaces the estimate of the frozen prefix with the measured prompt tokens of the first request (ARCHITECTURE.md 3.14).
async function storeMeasuredTokens(context: JobContext, held: HeldStep, promptTokens: number): Promise<void> {
  await withMeeting(context.db, held.meetingId, (trx) => trx.updateTable("meeting_members").set({ frozen_prefix_tokens: promptTokens })
    .where("meeting_id", "=", held.meetingId).where("side", "=", held.side).execute());
}

// What one speech request needs: the job context, the plan of the step, the prompts and the partial-text writer.
type SpeechScope = { context: JobContext; plan: StepPlan; prompts: MeetingPrompts; writer: PartialTextWriter };

// The receipts call of one turn. A model refusal, a timeout or a limit skips the receipts and the turn commits with no claims (R6.5).
async function checkReceipts(context: JobContext, request: { plan: StepPlan; prompts: MeetingPrompts; speechText: string }): Promise<ReceiptsOutcome> {
  const { plan, prompts } = request;
  const { held } = plan;
  const source = await readReceiptsSource(context.db, held);
  const input: ReceiptsInput = { side: held.side, speechText: request.speechText, cardQuotes: source.cardQuotes, recallTurns: source.recallTurns };
  try {
    return await runReceipts({
      messages: buildReceiptsMessages(prompts.receipts.text, input),
      call: (messages) => context.llm.complete(receiptsCallArgs({ meetingId: held.meetingId, promptVersion: prompts.receipts.version, messages })).then((result) => result.parsed),
      turns: source.turns,
      forbidden: forbiddenTexts(plan.question, prompts),
    });
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    context.log.warn({ code: "receipts_skipped", reason: error.code, meetingId: held.meetingId, stepSeq: held.stepSeq }, "The receipts check was skipped, so the turn commits with no claims.");
    return { claims: [], droppedCount: 0 };
  }
}

// Reads the speaker's approved card quotes and this step's recall results, in one transaction, with the full turns they cite.
async function readReceiptsSource(db: Kysely<Database>, held: HeldStep): Promise<ReceiptsSource> {
  return withMeeting(db, held.meetingId, async (trx) => {
    const isPublicOnly = await isPublicOnlyCard(trx, held.meetingId, held.cardId);
    const items = await trx.selectFrom("card_items as ci").innerJoin("turns as t", "t.id", "ci.turn_id")
      .select(["ci.position", "ci.claim", "ci.quote", "t.id as turn_id", "t.turn_index", "t.text", "t.norm_text"])
      .where("ci.card_id", "=", held.cardId).where("ci.approved", "=", true)
      .$if(isPublicOnly, (query) => query.where("ci.is_public", "=", true)).orderBy("ci.position").execute();
    const recall = await recallSnippets(trx, held);
    const turns = new Map<number, CitableTurn>();
    for (const row of items) turns.set(row.turn_index, { turnId: row.turn_id, turnIndex: row.turn_index, text: row.text, normText: row.norm_text });
    for (const row of recall.rows) if (!turns.has(row.turnIndex)) turns.set(row.turnIndex, row.turn);
    return {
      cardQuotes: items.map((row) => ({ turnIndex: row.turn_index, quote: row.quote, claim: row.claim })),
      recallTurns: recall.snippets,
      turns,
    };
  });
}

// The recall results of this step: each turn once, with the snippet the model saw and the whole turn.
async function recallSnippets(trx: Transaction<Database>, held: HeldStep): Promise<{ rows: Array<{ turnIndex: number; turn: CitableTurn }>; snippets: Array<{ turnIndex: number; text: string }> }> {
  const events = await readEvents(trx, held.meetingId, ["tool.result"]);
  const results = events.flatMap((event) => (event.type === "tool.result" && event.stepSeq === held.stepSeq && event.tool === "recall" ? recallResult.parse(event.result).turns : []));
  const rowsById = results.length === 0 ? [] : await trx.selectFrom("turns").select(["id", "turn_index", "text", "norm_text"]).where("id", "in", results.map((turn) => turn.turnId)).execute();
  const rows: Array<{ turnIndex: number; turn: CitableTurn }> = [];
  const snippets: Array<{ turnIndex: number; text: string }> = [];
  for (const result of results) {
    const row = rowsById.find((candidate) => candidate.id === result.turnId);
    if (row === undefined || snippets.some((snippet) => snippet.turnIndex === row.turn_index)) continue;
    rows.push({ turnIndex: row.turn_index, turn: { turnId: row.id, turnIndex: row.turn_index, text: row.text, normText: row.norm_text } });
    snippets.push({ turnIndex: row.turn_index, text: result.text });
  }
  return { rows, snippets };
}

// Handles a failure of the step: a lost step or meeting writes nothing; a limit returns the step to pending or ends the meeting; anything else stalls the step.
async function handleStepFailure(context: JobContext, payload: JobPayload<"meeting_step">, failure: { held: HeldStep | null; error: unknown }): Promise<void> {
  const { held, error } = failure;
  if (error instanceof ContractError && (error.code === "step_claim_lost" || error.code === "meeting_not_running")) return;
  if (error instanceof LimiterBusy) {
    if (held !== null) await releaseOn(context, held, "pending");
    await reenqueueAfterLimiter(context, "meeting_step", payload);
    return;
  }
  if (error instanceof CapReached) {
    await stopForCap(context, payload.meetingId, held);
    return;
  }
  if (held !== null) await releaseOn(context, held, "stalled");
  const code = error instanceof ContractError ? error.code : "step_failed";
  context.log.warn({ code, meetingId: payload.meetingId, stepSeq: payload.stepSeq }, "The step failed and is left stalled for the sweeper.");
}

// A dollar cap ended the call: the step stalls and the meeting ends with reason budget, then the briefs are queued, but only when
// this end ended the meeting; when another path ended it first, that path queued the briefs.
async function stopForCap(context: JobContext, meetingId: string, held: HeldStep | null): Promise<void> {
  const isEnded = await withMeeting(context.db, meetingId, async (trx) => {
    if (held !== null) await releaseStep(trx, refOf(held), "stalled");
    return endMeeting(trx, { meetingId, reason: "budget", now: context.now() });
  });
  if (isEnded) await context.enqueue("write_briefs", { meetingId });
}

// Moves the step this runner holds to pending or stalled, in its own short transaction.
async function releaseOn(context: JobContext, held: HeldStep, to: "pending" | "stalled"): Promise<void> {
  await withMeeting(context.db, held.meetingId, (trx) => releaseStep(trx, refOf(held), to));
}

// The events of these types in one meeting, in seq order, each rebuilt and checked by rowToEvent.
async function readEvents(trx: Transaction<Database>, meetingId: string, types: ReadonlyArray<CommittedEvent["type"]>): Promise<CommittedEvent[]> {
  const rows = await trx.selectFrom("meeting_events").select(["meeting_id", "seq", "type", "v", "payload", "created_at"])
    .where("meeting_id", "=", meetingId).where("type", "in", [...types]).orderBy("seq").execute();
  return rows.map(rowToEvent);
}

// The committed turns of a meeting as the prompt shows them (turn.committed events, in step order).
async function committedTurns(trx: Transaction<Database>, meetingId: string): Promise<PromptTurn[]> {
  const events = await readEvents(trx, meetingId, ["turn.committed"]);
  return events.flatMap((event) => (event.type === "turn.committed" && event.phase !== "close" ? [{ stepSeq: event.stepSeq, side: event.side, phase: event.phase, text: event.text }] : []));
}

// The other side's claims with their labels, for the decide prompt (D42).
async function otherSideClaims(trx: Transaction<Database>, held: HeldStep): Promise<PromptClaim[]> {
  return trx.selectFrom("claims").select(["step_seq", "position", "text", "quote"])
    .where("meeting_id", "=", held.meetingId).where("side", "<>", held.side)
    .orderBy("step_seq").orderBy("position").execute()
    .then((rows) => rows.map((row) => ({ stepSeq: row.step_seq, position: row.position, text: row.text, quote: row.quote })));
}

// True when this step already has a concede or a hold event, so a resumed decide turn keeps its decision (D42).
async function hasDecisionEvent(trx: Transaction<Database>, held: HeldStep): Promise<boolean> {
  const events = await readEvents(trx, held.meetingId, ["concede", "hold"]);
  return events.some((event) => (event.type === "concede" || event.type === "hold") && event.stepSeq === held.stepSeq);
}

// The tool calls of the step's assistant messages, after the first two messages (ARCHITECTURE.md 3.15).
function toolCallsOf(messages: readonly ChatMessage[]): Array<{ name: string; arguments: string }> {
  return messages.slice(2).flatMap((message) => (message.role === "assistant" ? (message.tool_calls ?? []) : [])).map((call) => ({ name: call.function.name, arguments: call.function.arguments }));
}

// The step's reference for the writes that name the attempt they were claimed with (D44).
function refOf(held: HeldStep | StepRow): HeldRef {
  return { meetingId: held.meetingId, stepSeq: held.stepSeq, attempt: held.attempt };
}
