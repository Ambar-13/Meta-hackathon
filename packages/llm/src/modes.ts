import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ContractError, RecordedCall, type CallSite, type LlmMode } from "@meet-first/contracts";

// One model request as the worker sends it. body is the chat completions request, exactly as it goes out.
export type LlmRequest = { callSite: CallSite; promptVersion: string; body: Record<string, unknown> };
// What a model call returns. httpStatus is null for a replay, because a stored reply has no status to return.
export type LlmReply = {
  response: Record<string, unknown>;
  usage: RecordedCall["usage"];
  requestId: string | null;
  httpStatus: number | null;
};
// The function that calls the live API. The worker passes the real client; tests pass a fake.
export type LiveCaller = (request: LlmRequest, signal: AbortSignal) => Promise<LlmReply>;
// Where recorded replies live, relative to the repository root.
export const FIXTURE_ROOT = "packages/evals/fixtures/model-replies";
// Characters per slice when a replayed streaming reply is sent in pieces. Picked here.
export const REPLAY_STREAM_SLICE_CHARS = 20;
// Milliseconds between two replayed slices, so the streaming path runs at a visible pace. The spec gives this value.
export const REPLAY_STREAM_SLICE_MS = 10;

// Sorts every object key at every depth, so the same body always gives the same text.
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  const text = JSON.stringify(value) as string | undefined;
  return text ?? "null";
}

// sha256 hex of the request body with keys sorted, so the same request always maps to one fixture file.
export function requestHash(body: Record<string, unknown>): string {
  return createHash("sha256").update(sortedJson(body)).digest("hex");
}

// The file that holds the recorded reply for one request.
function fixturePath(fixtureRoot: string, request: LlmRequest): string {
  return join(fixtureRoot, request.callSite, `${requestHash(request.body)}.json`);
}

// Reads one recorded reply. A missing file is refused with a sentence that says how to record it.
async function replayReply(file: string, request: LlmRequest): Promise<LlmReply> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) {
    throw new ContractError(
      "replay_fixture_missing",
      `No recorded reply for ${request.callSite} ${requestHash(request.body)}. Run the flow once with LLM_MODE=record or write the fixture by hand.`,
    );
  }
  const recorded = RecordedCall.parse(JSON.parse(text));
  return { response: recorded.response, usage: recorded.usage, requestId: null, httpStatus: null };
}

// Writes the reply of a live call to the fixture folder, so a later replay can read it.
async function recordReply(file: string, request: LlmRequest, reply: LlmReply): Promise<void> {
  const recorded: RecordedCall = {
    callSite: request.callSite,
    promptVersion: request.promptVersion,
    requestHash: requestHash(request.body),
    request,
    response: reply.response,
    usage: reply.usage,
    recordedAt: new Date().toISOString(),
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(recorded, null, 2)}\n`);
}

// Runs one call in the current mode: live calls the API; record calls it and writes the fixture; replay reads the fixture and never calls.
export async function runInMode(args: {
  mode: LlmMode;
  fixtureRoot: string;
  live: LiveCaller;
  request: LlmRequest;
  signal: AbortSignal;
}): Promise<LlmReply> {
  if (args.mode === "live") return args.live(args.request, args.signal);
  const file = fixturePath(args.fixtureRoot, args.request);
  if (args.mode === "replay") return replayReply(file, args.request);
  const reply = await args.live(args.request, args.signal);
  await recordReply(file, args.request, reply);
  return reply;
}

// Refuses to run replayed replies in production, so a demo never runs on recorded text.
export function assertModeAllowed(mode: LlmMode, nodeEnv: string | undefined): void {
  if (mode === "replay" && nodeEnv === "production") {
    throw new ContractError("llm_mode_replay_in_production", "Production cannot run on recorded replies. Set LLM_MODE=live.");
  }
}
