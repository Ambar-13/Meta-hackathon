import type { SourceHeader } from "@meet-first/contracts";
import { FILE_UNREADABLE_SENTENCE } from "./zip-stream.js";
import type { WorkerMessage, WorkerRequest } from "./worker-entry.js";

// What the person picked: a file from the picker, or the text in the paste box.
export type UploadInput = { kind: "file"; file: File } | { kind: "paste"; text: string };

// One progress message from the Web Worker, so the screen can show where it is.
export type UploadProgress = { stage: "reading" | "parsing" | "scrubbing" | "compressing"; inflatedBytes: number; keptTurns: number };

// The prepared upload: the NDJSON body plus the numbers the upload screen shows before the person attests.
export type UploadReady = {
  ok: true;
  header: SourceHeader; // the first NDJSON line, with attested: true
  foundTurns: number; // own turns found before the cut, for "kept n of m"
  keptTurns: number; // turns in the body after the size cut
  previewRedactionCount: number; // the browser scrub preview count shown with the consent copy; the server count is the one stored
  personaSignal: number;
  isLowSignal: boolean; // personaSignal < PERSONA_SIGNAL_LOW
  body: Blob; // header line plus turn lines, gzip when CompressionStream exists
  contentEncoding: "gzip" | null; // null is the uncompressed fallback when CompressionStream is undefined
};

// A refusal the screen shows as is: a stable code and the sentence to show.
export type UploadRefused = { ok: false; code: UploadRefusalCode; message: string };
// The refusal codes, each with its sentence.
export type UploadRefusalCode = "source_no_own_turns" | "source_file_not_json" | "zip_too_large" | "zip_inflated_too_large" | "file_unreadable" | "upload_too_large" | "upload_cancelled";

// The sentence for an upload the person stopped before it finished (the upload_cancelled row of the table in 4.4).
const UPLOAD_CANCELLED_SENTENCE = "The upload was stopped before it finished. Pick the file again to start over.";

// Runs extraction, ranking, the scrub preview and compression inside the Web Worker; resolves once, never rejects.
export function prepareUpload(
  input: UploadInput,
  options: { allowlist: string[]; onProgress: (progress: UploadProgress) => void; signal: AbortSignal },
): Promise<UploadReady | UploadRefused> {
  return new Promise((resolve) => {
    const cancelled: UploadRefused = { ok: false, code: "upload_cancelled", message: UPLOAD_CANCELLED_SENTENCE };
    if (options.signal.aborted) {
      resolve(cancelled);
      return;
    }
    const worker = new Worker(new URL("./worker-entry.ts", import.meta.url), { type: "module" });
    let isSettled = false;
    const finish = (result: UploadReady | UploadRefused): void => {
      if (isSettled) return;
      isSettled = true;
      worker.terminate();
      options.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => {
      finish(cancelled);
    };
    options.signal.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === "progress") options.onProgress(event.data.progress);
      else finish(event.data.result);
    };
    worker.onerror = () => {
      finish({ ok: false, code: "file_unreadable", message: FILE_UNREADABLE_SENTENCE });
    };
    worker.postMessage({ input, allowlist: options.allowlist } satisfies WorkerRequest);
  });
}
