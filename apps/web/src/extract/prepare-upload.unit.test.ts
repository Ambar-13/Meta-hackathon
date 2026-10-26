import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareUpload, type UploadProgress, type UploadRefused } from "./index.js";
import type { WorkerMessage } from "./worker-entry.js";
import { FILE_UNREADABLE_SENTENCE } from "./zip-stream.js";

// A stand-in for the browser Worker: it records what the page sends and lets a test send messages back.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: WorkerMessage }) => void) | null = null;
  onerror: (() => void) | null = null;
  received: unknown[] = [];
  terminateCalls = 0;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown): void {
    this.received.push(message);
  }
  terminate(): void {
    this.terminateCalls += 1;
  }
}

// Returns the worker the page created most recently, and throws when there is none.
function latestWorker(): FakeWorker {
  const worker = FakeWorker.instances[FakeWorker.instances.length - 1];
  if (worker === undefined) throw new Error("no worker was created");
  return worker;
}

const CANCELLED = "The upload was stopped before it finished. Pick the file again to start over.";

const refused: UploadRefused = { ok: false, code: "source_no_own_turns", message: "No messages written by you were found." };

describe("prepareUpload with a fake Worker", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.instances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("D1-T5: progress passes through and the done message resolves the upload (uses a fake Worker)", async () => {
    const onProgress = vi.fn<(progress: UploadProgress) => void>();
    const signal = new AbortController().signal;
    const promise = prepareUpload({ kind: "paste", text: "x" }, { allowlist: ["Asha"], onProgress, signal });
    const worker = latestWorker();
    expect(worker.received[0]).toEqual({ input: { kind: "paste", text: "x" }, allowlist: ["Asha"] });
    worker.onmessage?.({ data: { type: "progress", progress: { stage: "parsing", inflatedBytes: 0, keptTurns: 0 } } });
    worker.onmessage?.({ data: { type: "done", result: refused } });
    expect(await promise).toEqual(refused);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ stage: "parsing", inflatedBytes: 0, keptTurns: 0 });
    expect(worker.terminateCalls).toBe(1);
  });

  it("D1-T6: aborting resolves upload_cancelled and terminates the worker (uses a fake Worker)", async () => {
    const controller = new AbortController();
    const promise = prepareUpload({ kind: "paste", text: "x" }, { allowlist: [], onProgress: () => undefined, signal: controller.signal });
    const worker = latestWorker();
    controller.abort();
    expect(await promise).toEqual({ ok: false, code: "upload_cancelled", message: CANCELLED });
    expect(worker.terminateCalls).toBe(1);
    worker.onmessage?.({ data: { type: "done", result: refused } });
    expect(await promise).toEqual({ ok: false, code: "upload_cancelled", message: CANCELLED });
  });

  it("D1-T7: an already aborted signal creates no worker (uses a fake Worker)", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await prepareUpload({ kind: "paste", text: "x" }, { allowlist: [], onProgress: () => undefined, signal: controller.signal });
    expect(FakeWorker.instances.length).toBe(0);
    expect(result).toEqual({ ok: false, code: "upload_cancelled", message: CANCELLED });
  });

  it("D1-T8: a worker error resolves file_unreadable (uses a fake Worker)", async () => {
    const promise = prepareUpload({ kind: "paste", text: "x" }, { allowlist: [], onProgress: () => undefined, signal: new AbortController().signal });
    latestWorker().onerror?.();
    expect(await promise).toEqual({ ok: false, code: "file_unreadable", message: FILE_UNREADABLE_SENTENCE });
  });
});
