import { ContractError, PERSONA_SIGNAL_LOW, type SourceHeader } from "@meet-first/contracts";
import { extractOwnTurns, PARSER_VERSION, type ExtractInput } from "@meet-first/parsers";
import { SCRUB_VERSION } from "@meet-first/scrub";
import type { UploadInput, UploadProgress, UploadReady, UploadRefused, UploadRefusalCode } from "./index.js";
import { scrubForUpload } from "./scrub-preview.js";
import { buildNdjson, encodeUploadBody } from "./upload-body.js";
import { FILE_UNREADABLE_SENTENCE, INFLATED_MAX_BYTES, readPickedFile } from "./zip-stream.js";

// What the page sends the worker: one input and the allowlist.
export type WorkerRequest = { input: UploadInput; allowlist: string[] };
// What the worker sends back: any number of progress messages, then exactly one done message.
export type WorkerMessage = { type: "progress"; progress: UploadProgress } | { type: "done"; result: UploadReady | UploadRefused };
// The refusal codes the worker itself can produce; upload_cancelled is produced on the page.
export const WORKER_REFUSAL_CODES: readonly UploadRefusalCode[] = [
  "source_no_own_turns",
  "source_file_not_json",
  "zip_too_large",
  "zip_inflated_too_large",
  "file_unreadable",
  "upload_too_large",
];
// A reading progress message is sent each time another 16 MiB has been inflated.
export const READING_PROGRESS_STEP_BYTES = 16_777_216;

// True when a code is one the worker itself can produce, so it may be shown as the refusal's code.
function isWorkerRefusalCode(code: string): code is UploadRefusalCode {
  return (WORKER_REFUSAL_CODES as readonly string[]).includes(code);
}

// Turns any thrown value into the refusal the screen shows; anything unexpected becomes file_unreadable.
export function toRefusal(error: unknown): UploadRefused {
  if (error instanceof ContractError && isWorkerRefusalCode(error.code)) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "file_unreadable", message: FILE_UNREADABLE_SENTENCE };
}

// Reads the picked input into parser inputs, reporting each step of inflation as it passes another 16 MiB.
async function readInputs(input: UploadInput, onProgress: (progress: UploadProgress) => void, reading: { inflatedBytes: number }): Promise<ExtractInput[]> {
  if (input.kind === "paste") return [{ name: "paste.txt", text: input.text }];
  return readPickedFile(input.file, {
    inflatedCapBytes: INFLATED_MAX_BYTES,
    onInflated: (bytes) => {
      const previousStep = Math.floor(reading.inflatedBytes / READING_PROGRESS_STEP_BYTES);
      if (Math.floor(bytes / READING_PROGRESS_STEP_BYTES) > previousStep) {
        onProgress({ stage: "reading", inflatedBytes: bytes, keptTurns: 0 });
      }
      reading.inflatedBytes = bytes;
    },
  });
}

// The whole preparation in order: read, extract, scrub for the preview, compress. Throws on a refusal, and the caller turns it into one.
async function prepare(request: WorkerRequest, onProgress: (progress: UploadProgress) => void): Promise<UploadReady> {
  const reading = { inflatedBytes: 0 };
  onProgress({ stage: "reading", inflatedBytes: 0, keptTurns: 0 });
  const inputs = await readInputs(request.input, onProgress, reading);
  const kindHint = request.input.kind === "paste" ? "paste" : null;
  onProgress({ stage: "parsing", inflatedBytes: reading.inflatedBytes, keptTurns: 0 });
  const extracted = extractOwnTurns(inputs, kindHint);
  onProgress({ stage: "scrubbing", inflatedBytes: reading.inflatedBytes, keptTurns: extracted.turns.length });
  const preview = scrubForUpload(extracted.turns, request.allowlist);
  const header: SourceHeader = {
    kind: extracted.kind,
    parserVersion: PARSER_VERSION,
    scrubVersion: SCRUB_VERSION,
    personaSignal: extracted.personaSignal,
    attested: true,
    turnCount: preview.turns.length,
  };
  onProgress({ stage: "compressing", inflatedBytes: reading.inflatedBytes, keptTurns: preview.turns.length });
  const encoded = await encodeUploadBody(buildNdjson(header, preview.turns));
  return {
    ok: true,
    header,
    foundTurns: extracted.foundTurns,
    keptTurns: preview.turns.length,
    previewRedactionCount: preview.previewRedactionCount,
    personaSignal: extracted.personaSignal,
    isLowSignal: extracted.personaSignal < PERSONA_SIGNAL_LOW,
    body: encoded.body,
    contentEncoding: encoded.contentEncoding,
  };
}

// Read, extract, scrub for the preview, and compress, in that order; resolves once with the prepared upload or a refusal, never rejects.
export async function prepareInWorker(request: WorkerRequest, onProgress: (progress: UploadProgress) => void): Promise<UploadReady | UploadRefused> {
  try {
    return await prepare(request, onProgress);
  } catch (error) {
    return toRefusal(error);
  }
}

// The part of the worker global scope this module uses: the message channel in both directions.
type WorkerScope = {
  postMessage: (message: WorkerMessage) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

// Installs the message handler when this module runs inside a Web Worker, and does nothing on the page or in Node.
export function installWorkerHandler(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  if (typeof globals.WorkerGlobalScope !== "function") return;
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => {
    void prepareInWorker(event.data, (progress) => {
      scope.postMessage({ type: "progress", progress });
    }).then((result) => {
      scope.postMessage({ type: "done", result });
    });
  };
}

installWorkerHandler();
