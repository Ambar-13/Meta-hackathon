import openai from "openai";
import type { Kysely } from "kysely";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ContractError,
  workerEnv,
  type CallSite,
  type Effort,
  type RecordedCall,
  type ToolDefinition,
} from "@meet-first/contracts";
import { withMeeting, withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import { assertUnderCaps } from "./caps.js";
import { CALL_SITE_CONFIG, IMAGE_CALL_EST_TOKENS, lengthRetryFor } from "./call-sites.js";
import {
  buildChatRequest,
  estimateTokens,
  requestChars,
  type ChatMessage,
  type ChatRequestArgs,
  type ToolCall,
} from "./chat-request.js";
import { CHAT_MODEL, IMAGE_MODEL, IMAGE_SIZE, usdForImage, usdForUsage } from "./config.js";
import { finishLedgerRow, startLedgerRow, type LedgerFinish, type LedgerStart } from "./ledger.js";
import { assertWindowHasRoom } from "./limiter.js";
import {
  assertModeAllowed,
  FIXTURE_ROOT,
  requestHash,
  runInMode,
  type LiveCaller,
  type LlmReply,
  type LlmRequest,
} from "./modes.js";
import { withTransportRetries } from "./retries.js";
import {
  readChatStream,
  replayAsStream,
  replyLayoutFrom,
  ReplayResponse,
  usageFromVendor,
  type StreamHooks,
  type StreamOutcome,
} from "./stream-reader.js";

// The worker's variables, read with the contracts schema.
type WorkerEnv = z.infer<typeof workerEnv>;
// What one client needs: the database, the env, the clock, the sleep and random sources, and the
// seams a test replaces.
export type LlmClientDeps = {
  db: Kysely<Database>;
  env: WorkerEnv;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  fixtureRoot?: string;
  live?: LiveCaller;
  timeoutSignal?: (ms: number) => AbortSignal;
};
// The arguments of one non-streamed call. There is no transaction: the client writes its own ledger
// rows.
export type CompleteArgs = {
  callSite: CallSite;
  promptVersion: string;
  messages: ChatMessage[];
  schema?: { name: string; strict: true; schema: Record<string, unknown> };
  tools?: ToolDefinition[];
  promptCacheKey?: string;
  ledger: { personId: string | null; meetingId: string | null };
};
// What one call returns: text, the parsed JSON when a schema was sent, tool calls, finish reason,
// usage and the ledger row id.
export type CompleteResult = {
  text: string | null;
  parsed: unknown;
  toolCalls: ToolCall[];
  finishReason: "stop" | "length" | "tool_calls";
  usage: RecordedCall["usage"];
  ledgerId: string;
};
// A streamed call: the same arguments plus the two hooks the stream calls (meeting speech only).
export type StreamArgs = CompleteArgs & {
  onDelta: (text: string) => Promise<void>;
  onFirstToken: () => Promise<void>;
};
// One image call for the comic.
export type ImageArgs = {
  callSite: "comic_image";
  prompt: string;
  ledger: { personId: string | null; meetingId: string | null };
};
// The one object every job calls.
export type LlmClient = {
  complete: (args: CompleteArgs) => Promise<CompleteResult>;
  stream: (args: StreamArgs) => Promise<CompleteResult>;
  image: (args: ImageArgs) => Promise<{ webp: Uint8Array; ledgerId: string }>;
};

// The shared state every call of one client reads.
type ClientState = {
  db: Kysely<Database>;
  env: WorkerEnv;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  fixtureRoot: string;
  live: LiveCaller;
  hasInjectedLive: boolean;
  timeoutSignal: (ms: number) => AbortSignal;
  sdk: openai;
};
// One call as the client sends it: its body, its estimate, its effort, and whose ledger row it
// writes.
type CallCore = {
  callSite: CallSite;
  promptVersion: string;
  ledger: CompleteArgs["ledger"];
  body: Record<string, unknown>;
  estTokens: number;
  model: string;
  effort: Effort;
};
// The ledger row a finish writes to: its owner and its id.
type RowRef = { ledger: CompleteArgs["ledger"]; ledgerId: string };
// One finished attempt: its reply and the ledger row it wrote.
type Attempt = { reply: LlmReply; ledgerId: string };
// What a non-streamed reply says once it is read; isCut marks a reply that ran out of room or broke
// its schema.
type Reading = {
  text: string | null;
  parsed: unknown;
  toolCalls: ToolCall[];
  finishReason: "stop" | "length" | "tool_calls";
  isCut: boolean;
};
// The flags of one streamed attempt, set by its hooks and read when it ends.
type GateFlags = { hasFirstToken: boolean; hasDelivered: boolean; isFirstTokenLate: boolean };
// The timers and hooks of one streamed attempt.
type Gate = {
  deadline: AbortSignal;
  firstGate: AbortSignal | undefined;
  callAbort: AbortController;
  flags: GateFlags;
  hooks: StreamHooks;
  dispose: () => void;
};
// One streamed attempt that read to its end.
type StreamPass = {
  reply: LlmReply;
  outcome: StreamOutcome;
  ledgerId: string;
  hasDelivered: boolean;
};

const FIXTURE_DIR = fileURLToPath(new URL(`../../../${FIXTURE_ROOT}`, import.meta.url));
const ZERO_USAGE: RecordedCall["usage"] = {
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
};
const ToolCallShape = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
const Completion = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullable().optional(),
                tool_calls: z.array(ToolCallShape).optional(),
              })
              .passthrough(),
            finish_reason: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
const ImageReply = z
  .object({ data: z.array(z.object({ b64_json: z.string().min(1) }).passthrough()).min(1) })
  .passthrough();
const RecordResponse = z.record(z.string(), z.unknown());
const VendorStatus = z.object({ status: z.number().int() }).passthrough();

// The SDK instance, built once with our own retries and the base URL.
export function makeSdk(env: Pick<WorkerEnv, "META_API_KEY" | "META_API_BASE_URL">): openai {
  return new openai({ apiKey: env.META_API_KEY, baseURL: env.META_API_BASE_URL, maxRetries: 0 });
}

// The usage recorded when a live reply carries none, or a live attempt fails before it reports any:
// the request estimate as prompt tokens and max_tokens as completion tokens, so the caps count the
// worst case.
export function worstCaseUsage(body: Record<string, unknown>): RecordedCall["usage"] {
  return {
    promptTokens: estimateTokens(requestChars(body), null),
    cachedTokens: 0,
    completionTokens: typeof body.max_tokens === "number" ? body.max_tokens : 0,
    reasoningTokens: 0,
  };
}

// The non-streamed live caller: one SDK call with the call site's timeout and the attempt's signal.
export function makeLiveCaller(sdk: openai): LiveCaller {
  return async (request, signal) => {
    const options = { timeout: CALL_SITE_CONFIG[request.callSite].timeoutMs, signal };
    if (request.callSite === "comic_image") {
      const response = RecordResponse.parse(
        await sdk.images.generate(
          request.body as unknown as openai.Images.ImageGenerateParams,
          options,
        ),
      );
      return { response, usage: ZERO_USAGE, requestId: requestIdOf(response), httpStatus: 200 };
    }
    const response = RecordResponse.parse(
      await sdk.chat.completions.create(
        request.body as unknown as openai.Chat.ChatCompletionCreateParamsNonStreaming,
        options,
      ),
    );
    return {
      response,
      usage: usageFromVendor(response.usage) ?? worstCaseUsage(request.body),
      requestId: requestIdOf(response),
      httpStatus: 200,
    };
  };
}

// The streamed live caller: reads the SDK stream so deltas reach the hooks as they arrive, and
// returns the recorded layout.
export function makeStreamingLiveCaller(sdk: openai, hooks: StreamHooks): LiveCaller {
  return async (request, signal) => {
    const options = { timeout: CALL_SITE_CONFIG[request.callSite].timeoutMs, signal };
    const chunks = await sdk.chat.completions.create(
      request.body as unknown as openai.Chat.ChatCompletionCreateParamsStreaming,
      options,
    );
    const outcome = await readChatStream(chunks, hooks, signal);
    return {
      response: replyLayoutFrom(outcome),
      usage: outcome.usage ?? worstCaseUsage(request.body),
      requestId: null,
      httpStatus: 200,
    };
  };
}

// Refuses replay in production for this worker env. The mode is read inside packages/llm because CI
// rejects its variable name in every other folder.
export function assertWorkerModeAllowed(env: WorkerEnv, nodeEnv: string | undefined): void {
  assertModeAllowed(env.LLM_MODE, nodeEnv);
}

// Builds the client. The SDK is constructed once with maxRetries 0 and the base URL; every call
// sets its own timeout and signal.
export function makeLlmClient(deps: LlmClientDeps): LlmClient {
  const sdk = makeSdk(deps.env);
  const state: ClientState = {
    db: deps.db,
    env: deps.env,
    now: deps.now,
    sleep: deps.sleep,
    random: deps.random,
    fixtureRoot: deps.fixtureRoot ?? FIXTURE_DIR,
    live: deps.live ?? makeLiveCaller(sdk),
    hasInjectedLive: deps.live !== undefined,
    timeoutSignal: deps.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms)),
    sdk,
  };
  return {
    complete: (args) => complete(state, args),
    stream: (args) => stream(state, args),
    image: (args) => image(state, args),
  };
}

// The request id of a reply, or null when the vendor sent none.
function requestIdOf(response: Record<string, unknown>): string | null {
  return typeof response.id === "string" ? response.id : null;
}

// Refuses a call that names no person and no meeting, before any row is written; only the boot
// self-test may do so.
function assertLedgerOwner(callSite: CallSite, ledger: CompleteArgs["ledger"]): void {
  if (ledger.personId === null && ledger.meetingId === null && callSite !== "self_test") {
    throw new ContractError(
      "ledger_context_missing",
      "A model call must name a person or a meeting for its ledger row. Pass ledger.personId or ledger.meetingId.",
      500,
    );
  }
}

// Runs one ledger write in its own short transaction, as the person or the meeting; the self-test
// runs as nobody.
async function inLedger<T>(
  state: ClientState,
  ledger: CompleteArgs["ledger"],
  write: (trx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  if (ledger.personId !== null) return withPerson(state.db, ledger.personId, write);
  if (ledger.meetingId !== null) return withMeeting(state.db, ledger.meetingId, write);
  return state.db.transaction().execute(write);
}

// The ledger row a call starts with: its owner, model, effort, estimate and mode.
function startOf(state: ClientState, core: CallCore): LedgerStart {
  return {
    personId: core.ledger.personId,
    meetingId: core.ledger.meetingId,
    callSite: core.callSite,
    model: core.model,
    effort: core.effort,
    estTokens: core.estTokens,
    llmMode: state.env.LLM_MODE,
  };
}

// Finishes a ledger row in its own transaction.
async function finishRow(state: ClientState, row: RowRef, finish: LedgerFinish): Promise<void> {
  await inLedger(state, row.ledger, (trx) => finishLedgerRow(trx, row.ledgerId, finish));
}

// The HTTP status of a vendor error, when it carries one.
function vendorStatus(error: unknown): number | undefined {
  if (!(error instanceof openai.APIError)) return undefined;
  const parsed = VendorStatus.safeParse(error);
  return parsed.success ? parsed.data.status : undefined;
}

// The ledger finish for an attempt that threw: timeout when its deadline fired, else error, with
// the status when there is one.
function failureFinish(error: unknown, timedOut: boolean): LedgerFinish {
  const httpStatus = vendorStatus(error);
  return {
    status: timedOut ? "timeout" : "error",
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

// The ledger finish for a reply that came back: its usage and dollars, and its status and id when
// the reply had them.
function finishFromReply(status: "ok" | "error", reply: LlmReply): LedgerFinish {
  return {
    status,
    usage: reply.usage,
    usd: usdForUsage(reply.usage),
    ...(reply.httpStatus === null ? {} : { httpStatus: reply.httpStatus }),
    ...(reply.requestId === null ? {} : { requestId: reply.requestId }),
  };
}

// True when a replay had no recorded reply for this request.
function isReplayMiss(error: unknown): boolean {
  return error instanceof ContractError && error.code === "replay_fixture_missing";
}

// The usage and dollars of an attempt that threw. Meta may have billed a live or recorded chat call
// that timed out, was aborted, broke mid-stream or failed without an HTTP status, so its row counts
// the worst case, which the caps and the meeting token stop read. A vendor HTTP error, a replay
// miss, replay mode and comic_image count nothing: replay calls nobody, and Meta bills an image
// only when it is returned.
function failureCharge(
  state: ClientState,
  core: CallCore,
  error: unknown,
): Pick<LedgerFinish, "usage" | "usd"> {
  const canBeBilled = state.env.LLM_MODE === "live" || state.env.LLM_MODE === "record";
  if (
    !canBeBilled ||
    core.callSite === "comic_image" ||
    vendorStatus(error) !== undefined ||
    isReplayMiss(error)
  )
    return {};
  const usage = worstCaseUsage(core.body);
  return { usage, usd: usdForUsage(usage) };
}

// Writes the request of a replay miss to the temp folder, so a fixture can be made from the exact
// body the code sent.
function writeMissFile(core: CallCore): void {
  const path = join(
    tmpdir(),
    "meet-first-replay-misses",
    core.callSite,
    `${requestHash(core.body)}.request.json`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ callSite: core.callSite, promptVersion: core.promptVersion, body: core.body }, null, 2)}\n`,
  );
}

// The error a failed non-streamed attempt raises: a replay miss stays as it is, a deadline becomes
// model_call_timeout.
function attemptFailure(core: CallCore, error: unknown, timedOut: boolean): unknown {
  if (isReplayMiss(error)) {
    writeMissFile(core);
    return error;
  }
  if (timedOut)
    return new ContractError(
      "model_call_timeout",
      "The model did not answer within the call's time limit. The call is retried.",
      504,
    );
  return error;
}

// Writes the ledger row for one attempt, then runs the call in the current mode under its deadline.
async function runAttempt(state: ClientState, core: CallCore): Promise<Attempt> {
  const ledgerId = await inLedger(state, core.ledger, (trx) =>
    startLedgerRow(trx, startOf(state, core)),
  );
  const deadline = state.timeoutSignal(CALL_SITE_CONFIG[core.callSite].timeoutMs);
  const request: LlmRequest = {
    callSite: core.callSite,
    promptVersion: core.promptVersion,
    body: core.body,
  };
  try {
    const reply = await runInMode({
      mode: state.env.LLM_MODE,
      fixtureRoot: state.fixtureRoot,
      live: state.live,
      request,
      signal: deadline,
    });
    return { reply, ledgerId };
  } catch (error) {
    await finishRow(
      state,
      { ledger: core.ledger, ledgerId: ledgerId },
      { ...failureFinish(error, deadline.aborted), ...failureCharge(state, core, error) },
    );
    throw attemptFailure(core, error, deadline.aborted);
  }
}

// The request arguments a call carries, with the optional keys left out when they were not given.
function requestArgsOf(args: CompleteArgs): Omit<ChatRequestArgs, "stream"> {
  return {
    callSite: args.callSite,
    messages: args.messages,
    ...(args.schema === undefined ? {} : { schema: args.schema }),
    ...(args.tools === undefined ? {} : { tools: args.tools }),
    ...(args.promptCacheKey === undefined ? {} : { promptCacheKey: args.promptCacheKey }),
  };
}

// The call a set of arguments makes: its body, its estimate and its effort; an override builds the
// length retry.
function coreOf(
  args: CompleteArgs,
  isStreamed: boolean,
  override?: { effort: Effort; maxTokens: number },
): CallCore {
  const body = buildChatRequest({
    ...requestArgsOf(args),
    stream: isStreamed,
    ...(override === undefined ? {} : { override }),
  });
  return {
    callSite: args.callSite,
    promptVersion: args.promptVersion,
    ledger: args.ledger,
    body,
    estTokens: estimateTokens(requestChars(body), null),
    model: CHAT_MODEL,
    effort: override?.effort ?? CALL_SITE_CONFIG[args.callSite].effort,
  };
}

// Parses a JSON reply, or reports that it did not parse (a missing content counts as a cut reply).
function jsonOf(content: string | null): { ok: boolean; value: unknown } {
  if (content === null) return { ok: false, value: null };
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch {
    return { ok: false, value: null };
  }
}

// Maps a vendor finish reason to the three the client keeps; anything else is stop.
function reasonOf(reason: string | null): "stop" | "length" | "tool_calls" {
  if (reason === "length") return "length";
  if (reason === "tool_calls") return "tool_calls";
  return "stop";
}

// Reads one non-streamed reply: its text, its JSON when a schema was sent, its tool calls, and
// whether it was cut.
function readCompletion(reply: LlmReply, structured: boolean): Reading {
  const parsed = Completion.safeParse(reply.response);
  const choice = parsed.success ? parsed.data.choices[0] : undefined;
  if (choice === undefined)
    throw new ContractError(
      "model_reply_invalid",
      "The model reply has no usable choice. Check the fixture or the vendor response.",
      502,
    );
  const text = choice.message.content ?? null;
  const finishReason = reasonOf(choice.finish_reason ?? null);
  const json = structured ? jsonOf(text) : { ok: true, value: null };
  return {
    text,
    parsed: json.value,
    toolCalls: choice.message.tool_calls ?? [],
    finishReason,
    isCut: finishReason === "length" || !json.ok,
  };
}

// One non-streamed round: the attempt with its transport retries, then the reading; a cut reply is
// retried once at minimal effort.
async function completeRound(
  state: ClientState,
  args: CompleteArgs,
  lengthRetry: boolean,
): Promise<CompleteResult> {
  const core = coreOf(args, false, lengthRetry ? lengthRetryFor(args.callSite) : undefined);
  const attempt = await withTransportRetries(() => runAttempt(state, core), {
    sleep: state.sleep,
    random: state.random,
  });
  const isSelfTest = args.callSite === "self_test";
  let reading: Reading;
  try {
    reading = readCompletion(attempt.reply, !isSelfTest && args.schema !== undefined);
  } catch (error) {
    // A reply came back, so Meta billed it even though it is unusable: the row keeps its usage and
    // dollars.
    await finishRow(
      state,
      { ledger: args.ledger, ledgerId: attempt.ledgerId },
      finishFromReply("error", attempt.reply),
    );
    throw error;
  }
  if (isSelfTest) {
    await finishRow(
      state,
      { ledger: args.ledger, ledgerId: attempt.ledgerId },
      finishFromReply("ok", attempt.reply),
    );
    return {
      text: reading.text,
      parsed: null,
      toolCalls: [],
      finishReason: reading.finishReason,
      usage: attempt.reply.usage,
      ledgerId: attempt.ledgerId,
    };
  }
  if (reading.isCut) {
    await finishRow(
      state,
      { ledger: args.ledger, ledgerId: attempt.ledgerId },
      finishFromReply("error", attempt.reply),
    );
    if (lengthRetry)
      throw new ContractError(
        "model_output_cut",
        "The model ran out of room twice. The job falls back to its template.",
      );
    return completeRound(state, args, true);
  }
  await finishRow(
    state,
    { ledger: args.ledger, ledgerId: attempt.ledgerId },
    finishFromReply("ok", attempt.reply),
  );
  return {
    text: reading.text,
    parsed: reading.parsed,
    toolCalls: reading.toolCalls,
    finishReason: reading.finishReason,
    usage: attempt.reply.usage,
    ledgerId: attempt.ledgerId,
  };
}

// The non-streamed call: caps and the shared window first, then the round.
async function complete(state: ClientState, args: CompleteArgs): Promise<CompleteResult> {
  assertLedgerOwner(args.callSite, args.ledger);
  await assertUnderCaps(state.db, state.env, { callSite: args.callSite, now: state.now });
  await assertWindowHasRoom(state.db, "chat", state.now);
  return completeRound(state, args, false);
}

// The deadline and first-token gate of one streamed attempt: a late first token aborts the call, a
// late call aborts it too.
function openGate(state: ClientState, args: StreamArgs): Gate {
  const config = CALL_SITE_CONFIG[args.callSite];
  const deadline = state.timeoutSignal(config.timeoutMs);
  const firstGate =
    config.firstTokenMs === undefined ? undefined : state.timeoutSignal(config.firstTokenMs);
  const callAbort = new AbortController();
  const flags: GateFlags = { hasFirstToken: false, hasDelivered: false, isFirstTokenLate: false };
  const onDeadline = (): void => {
    callAbort.abort();
  };
  const onFirstGate = (): void => {
    flags.isFirstTokenLate = true;
    if (!flags.hasFirstToken) callAbort.abort();
  };
  deadline.addEventListener("abort", onDeadline);
  firstGate?.addEventListener("abort", onFirstGate);
  const hooks: StreamHooks = {
    now: state.now,
    onFirstToken: async () => {
      flags.hasFirstToken = true;
      firstGate?.removeEventListener("abort", onFirstGate);
      await args.onFirstToken();
    },
    onDelta: async (text) => {
      flags.hasDelivered = true;
      await args.onDelta(text);
    },
  };
  const dispose = (): void => {
    deadline.removeEventListener("abort", onDeadline);
    firstGate?.removeEventListener("abort", onFirstGate);
  };
  return { deadline, firstGate, callAbort, flags, hooks, dispose };
}

// The outcome of a streamed reply the live caller already sent to the hooks: read from its layout,
// with no hook call.
function outcomeFromLayout(reply: LlmReply): StreamOutcome {
  const choice = ReplayResponse.parse(reply.response).choices[0];
  return {
    text: choice.message.content ?? "",
    toolCalls: choice.message.tool_calls ?? [],
    finishReason: choice.finish_reason ?? "cut",
    usage: null,
    firstTokenAt: null,
  };
}

// The error a failed streamed attempt raises, in this order: text already shown first, then the
// timers, then a replay miss.
function streamFailure(core: CallCore, error: unknown, gate: Gate): unknown {
  if (gate.flags.hasDelivered)
    return new ContractError(
      "model_stream_cut",
      "The model stream broke after text was shown. Discard this round's partial text and retry the round once.",
      502,
    );
  if (gate.flags.isFirstTokenLate)
    return new ContractError(
      "model_first_token_timeout",
      "The model sent nothing within the first-token limit. The call is retried once.",
      504,
    );
  if (gate.deadline.aborted)
    return new ContractError(
      "model_call_timeout",
      "The model did not answer within the call's time limit. The call is retried.",
      504,
    );
  if (isReplayMiss(error)) writeMissFile(core);
  return error;
}

// One streamed attempt: writes its row, runs the call, reads the stream or the replay, and finishes
// the row as a failure when it throws.
async function streamAttempt(
  state: ClientState,
  args: StreamArgs,
  core: CallCore,
): Promise<StreamPass> {
  const ledgerId = await inLedger(state, core.ledger, (trx) =>
    startLedgerRow(trx, startOf(state, core)),
  );
  const gate = openGate(state, args);
  try {
    const isStreamed = !state.hasInjectedLive && state.env.LLM_MODE !== "replay";
    const live = isStreamed ? makeStreamingLiveCaller(state.sdk, gate.hooks) : state.live;
    const request: LlmRequest = {
      callSite: core.callSite,
      promptVersion: core.promptVersion,
      body: core.body,
    };
    const reply = await runInMode({
      mode: state.env.LLM_MODE,
      fixtureRoot: state.fixtureRoot,
      live,
      request,
      signal: gate.callAbort.signal,
    });
    const outcome = isStreamed
      ? outcomeFromLayout(reply)
      : await replayAsStream(reply.response, gate.hooks);
    return { reply, outcome, ledgerId, hasDelivered: gate.flags.hasDelivered };
  } catch (error) {
    const isTimedOut = gate.deadline.aborted || gate.firstGate?.aborted === true;
    await finishRow(
      state,
      { ledger: core.ledger, ledgerId: ledgerId },
      { ...failureFinish(error, isTimedOut), ...failureCharge(state, core, error) },
    );
    throw streamFailure(core, error, gate);
  } finally {
    gate.dispose();
  }
}

// One streamed round with its transport retries; a cut or length reply before any text is shown is
// retried once.
async function streamRound(
  state: ClientState,
  args: StreamArgs,
  lengthRetry: boolean,
): Promise<CompleteResult> {
  const core = coreOf(args, true, lengthRetry ? lengthRetryFor(args.callSite) : undefined);
  const pass = await withTransportRetries(() => streamAttempt(state, args, core), {
    sleep: state.sleep,
    random: state.random,
  });
  const { reply, outcome, ledgerId } = pass;
  if (outcome.finishReason !== "length" && outcome.finishReason !== "cut") {
    await finishRow(
      state,
      { ledger: args.ledger, ledgerId: ledgerId },
      finishFromReply("ok", reply),
    );
    return {
      text: outcome.text === "" && outcome.toolCalls.length > 0 ? null : outcome.text,
      parsed: null,
      toolCalls: outcome.toolCalls,
      finishReason: outcome.finishReason,
      usage: reply.usage,
      ledgerId,
    };
  }
  await finishRow(
    state,
    { ledger: args.ledger, ledgerId: ledgerId },
    finishFromReply("error", reply),
  );
  if (pass.hasDelivered) {
    if (outcome.finishReason === "cut")
      throw new ContractError(
        "model_stream_cut",
        "The model stream broke after text was shown. Discard this round's partial text and retry the round once.",
        502,
      );
    throw new ContractError(
      "model_stream_length",
      "The model ran out of room after text was shown. Discard this round's partial text and retry the round once.",
      502,
    );
  }
  if (lengthRetry)
    throw new ContractError(
      "model_output_cut",
      "The model ran out of room twice. The job falls back to its template.",
    );
  return streamRound(state, args, true);
}

// The streamed call: refuses a schema, then caps and the window, then the round.
async function stream(state: ClientState, args: StreamArgs): Promise<CompleteResult> {
  if (args.schema !== undefined)
    throw new ContractError(
      "stream_schema_refused",
      "A streamed call cannot carry an output schema (D39). Use complete for structured output.",
      500,
    );
  assertLedgerOwner(args.callSite, args.ledger);
  await assertUnderCaps(state.db, state.env, { callSite: args.callSite, now: state.now });
  await assertWindowHasRoom(state.db, "chat", state.now);
  return streamRound(state, args, false);
}

// One image call for the comic: one attempt, no retries, zero usage and a fixed dollar price.
async function image(
  state: ClientState,
  args: ImageArgs,
): Promise<{ webp: Uint8Array; ledgerId: string }> {
  assertLedgerOwner(args.callSite, args.ledger);
  await assertUnderCaps(state.db, state.env, { callSite: args.callSite, now: state.now });
  await assertWindowHasRoom(state.db, "image", state.now);
  const core: CallCore = {
    callSite: "comic_image",
    promptVersion: "v1",
    ledger: args.ledger,
    body: {
      model: IMAGE_MODEL,
      prompt: args.prompt,
      size: IMAGE_SIZE,
      response_format: "b64_json",
      output_format: "webp",
    },
    estTokens: IMAGE_CALL_EST_TOKENS,
    model: IMAGE_MODEL,
    effort: CALL_SITE_CONFIG.comic_image.effort,
  };
  const attempt = await runAttempt(state, core);
  const data = ImageReply.safeParse(attempt.reply.response);
  const first = data.success ? data.data.data[0] : undefined;
  if (first === undefined) {
    await finishRow(
      state,
      { ledger: args.ledger, ledgerId: attempt.ledgerId },
      { status: "error" },
    );
    throw new ContractError(
      "model_reply_invalid",
      "The model reply has no usable choice. Check the fixture or the vendor response.",
      502,
    );
  }
  await finishRow(
    state,
    { ledger: args.ledger, ledgerId: attempt.ledgerId },
    { ...finishFromReply("ok", attempt.reply), usage: ZERO_USAGE, usd: usdForImage() },
  );
  return {
    webp: new Uint8Array(Buffer.from(first.b64_json, "base64")),
    ledgerId: attempt.ledgerId,
  };
}
