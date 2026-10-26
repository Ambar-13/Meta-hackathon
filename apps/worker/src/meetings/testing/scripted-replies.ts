import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ContractError, RecordedCall, type CallSite } from "@meet-first/contracts";
import { buildChatRequest, requestHash, type CompleteArgs, type CompleteResult, type LlmClient, type StreamArgs } from "@meet-first/llm";

// One scripted speech reply: the streamed text, and the tool calls with their arguments.
export type ScriptedSpeech = { text: string; toolCalls?: ReadonlyArray<{ name: "recall" | "concede" | "hold"; arguments: Record<string, unknown> }> };
// The replies of one scripted run, per call site, used in call order.
export type ReplyScript = { speech: ScriptedSpeech[]; receipts: unknown[]; questionCheck: unknown[] };
// The wrapped client, plus what is left of the script and which fixture files it wrote.
export type ScriptedClient = LlmClient & { remaining: () => { speech: number; receipts: number; questionCheck: number }; written: string[] };

// The queues of one run: the replies still to send, per call site.
type Queues = { speech: ScriptedSpeech[]; receipts: unknown[]; questionCheck: unknown[] };

// Wraps a replay client so each missing fixture is written from the script right before the client reads it. killAfterReply makes the next times calls of one call site throw a plain error after the client returned, as a worker stopped between the reply and the commit would (a fake, for R5.2).
export function withScriptedReplies(client: LlmClient, script: ReplyScript, options: { fixtureRoot: string; killAfterReply?: { callSite: CallSite; times: number } }): ScriptedClient {
  // The queues are the script's own arrays, so a test may push a reply after the client exists and the next request reads it.
  const queues: Queues = script;
  const written: string[] = [];
  const state = { counter: 1, killsLeft: options.killAfterReply?.times ?? 0 };
  const ensureFixture = async (args: CompleteArgs, isStream: boolean): Promise<void> => {
    const body = chatBodyFor(args, isStream);
    const path = join(options.fixtureRoot, args.callSite, requestHash(body) + ".json");
    if (await access(path).then(() => true, () => false)) return;
    const response = nextResponse(queues, args.callSite, state);
    await mkdir(join(options.fixtureRoot, args.callSite), { recursive: true });
    await writeFile(path, JSON.stringify(scriptedRecordedCall({ callSite: args.callSite, promptVersion: args.promptVersion, body }, response), null, 2) + "\n");
    written.push(path);
  };
  const afterReply = <T extends CompleteResult>(callSite: CallSite, result: T): T => {
    if (options.killAfterReply?.callSite !== callSite || state.killsLeft <= 0) return result;
    state.killsLeft -= 1;
    throw new Error("scripted_kill: A test stopped this job after the model replied and before the commit.");
  };
  return {
    complete: async (args) => {
      await ensureFixture(args, false);
      return afterReply(args.callSite, await client.complete(args));
    },
    stream: async (args: StreamArgs) => {
      await ensureFixture(args, true);
      return afterReply(args.callSite, await client.stream(args));
    },
    image: client.image,
    remaining: () => ({ speech: queues.speech.length, receipts: queues.receipts.length, questionCheck: queues.questionCheck.length }),
    written,
  };
}

// The stream replay layout of one scripted speech reply (wave-1-dossier.md section 4.3); tool call ids are call_<n> with n from the run's counter.
export function speechReplyLayout(reply: ScriptedSpeech, firstCallNumber: number): Record<string, unknown> {
  const calls = reply.toolCalls ?? [];
  if (calls.length === 0) {
    return { choices: [{ index: 0, message: { role: "assistant", content: reply.text }, finish_reason: "stop" }] };
  }
  const toolCalls = calls.map((call, index) => ({ id: "call_" + String(firstCallNumber + index), type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
  return { choices: [{ index: 0, message: { role: "assistant", content: reply.text === "" ? null : reply.text, tool_calls: toolCalls }, finish_reason: "tool_calls" }] };
}

// The non-streamed reply layout of one scripted structured output: one choice whose content is the output as JSON.
export function structuredReplyLayout(output: unknown): Record<string, unknown> {
  return { choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }] };
}

// The RecordedCall a scripted reply becomes: handWritten true, recordedAt null, usage all zeros (seams S6).
export function scriptedRecordedCall(request: { callSite: CallSite; promptVersion: string; body: Record<string, unknown> }, response: Record<string, unknown>): RecordedCall {
  return RecordedCall.parse({
    callSite: request.callSite,
    promptVersion: request.promptVersion,
    requestHash: requestHash(request.body),
    request: { callSite: request.callSite, promptVersion: request.promptVersion, body: request.body },
    response,
    usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 },
    recordedAt: null,
    handWritten: true,
  });
}

// The request body the dossier client sends for these call arguments, so a fixture's hash is the hash of the job's request (D74).
export function chatBodyFor(args: CompleteArgs, isStream: boolean): Record<string, unknown> {
  return buildChatRequest({
    callSite: args.callSite,
    messages: args.messages,
    stream: isStream,
    ...(args.tools === undefined ? {} : { tools: args.tools }),
    ...(args.schema === undefined ? {} : { schema: args.schema }),
    ...(args.promptCacheKey === undefined ? {} : { promptCacheKey: args.promptCacheKey }),
  });
}

// The next scripted reply of one call site, shaped as the client reads it; the speech counter moves by the tool calls it used.
function nextResponse(queues: Queues, callSite: CallSite, state: { counter: number }): Record<string, unknown> {
  const queue = queueFor(queues, callSite);
  if (callSite === "speech") {
    const reply = takeReply(queues.speech, callSite);
    state.counter += reply.toolCalls?.length ?? 0;
    return speechReplyLayout(reply, state.counter - (reply.toolCalls?.length ?? 0));
  }
  return structuredReplyLayout(takeReply(queue, callSite));
}

// The queue a call site reads from, or a refusal for a call site the script does not cover.
function queueFor(queues: Queues, callSite: CallSite): unknown[] {
  if (callSite === "speech") return queues.speech;
  if (callSite === "receipts") return queues.receipts;
  if (callSite === "question_check") return queues.questionCheck;
  throw new ContractError("script_call_site_unknown", "The scripted replies cover speech, receipts and question_check only.", 500);
}

// The next reply of a queue, in call order; an empty queue is a test mistake.
function takeReply<T>(queue: T[], callSite: CallSite): T {
  const next = queue.shift();
  if (next === undefined) throw new ContractError("script_exhausted", "The test script has no " + callSite + " reply left for this request. Add one in call order.", 500);
  return next;
}
