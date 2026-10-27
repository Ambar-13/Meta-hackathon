import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { ContractError } from "@meet-first/contracts";
import chatgpt2024Text from "../../../../packages/parsers/fixtures/chatgpt-2024-mapping.json?raw";
import pasteText from "../../../../packages/parsers/fixtures/paste.txt?raw";
import codeOnlyText from "../../../../packages/parsers/fixtures/code-only.json?raw";
import codexText from "../../../../packages/parsers/fixtures/codex-session.jsonl?raw";
import type { UploadProgress, UploadReady, UploadRefused } from "./index.js";
import { FILE_UNREADABLE_SENTENCE } from "./zip-stream.js";
import { installWorkerHandler, prepareInWorker, toRefusal, type WorkerRequest } from "./worker-entry.js";

// The progress messages of the most recent call, in order.
const stages: UploadProgress[] = [];

// Runs the worker preparation with one input and the given allowlist, and records its progress.
async function run(input: WorkerRequest["input"], allowlist = ["Asha Rao"]) {
  return prepareInWorker({ input, allowlist }, (progress) => stages.push(progress));
}

// Returns the result as a ready upload and throws when it is a refusal.
function readyOf(result: UploadReady | UploadRefused): UploadReady {
  if (!result.ok) throw new Error(`expected an upload, got refusal ${result.code}`);
  return result;
}

// Gunzips a blob through the browser decompressor and returns its text.
async function gunzipped(body: Blob): Promise<string> {
  return new Response(body.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

describe("prepareInWorker", () => {
  it("D1-T1: a zipped ChatGPT export becomes a body of own turns only", async () => {
    stages.length = 0;
    const zip = zipSync({ "conversations.json": strToU8(chatgpt2024Text) });
    const ready = readyOf(await run({ kind: "file", file: new File([zip], "chatgpt-export.zip") }));
    expect(ready.header).toEqual({
      kind: "chatgpt",
      parserVersion: "1",
      scrubVersion: "1",
      personaSignal: 1,
      attested: true,
      turnCount: 7,
    });
    expect(ready.foundTurns).toBe(7);
    expect(ready.keptTurns).toBe(7);
    expect(ready.previewRedactionCount).toBe(0);
    expect(ready.isLowSignal).toBe(false);
    expect(ready.contentEncoding).toBe("gzip");
    const body = await gunzipped(ready.body);
    const lines = body.split("\n");
    expect(lines.length).toBe(8);
    expect(body).toContain("I keep rewriting my CV");
    expect(body).not.toContain("Shall I shorten it?");
    expect(body).not.toContain("What do you want a reader to notice first?");
  });

  it("D1-T10: a zipped folder of Codex sessions becomes a body of the person's own turns, stored as chatgpt", async () => {
    stages.length = 0;
    const reviewer = [
      JSON.stringify({ type: "session_meta", payload: { source: { subagent: { other: "guardian" } }, thread_source: "guardian_review" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Review this command: rm -rf build" }] } }),
    ].join("\n");
    const zip = zipSync({ "sessions/2026/10/02/rollout-a.jsonl": strToU8(codexText), "sessions/2026/10/02/rollout-b.jsonl": strToU8(reviewer) });
    const ready = readyOf(await run({ kind: "file", file: new File([zip], "codex-sessions.zip") }));
    expect(ready.header.kind).toBe("chatgpt");
    expect(ready.foundTurns).toBe(6);
    expect(ready.keptTurns).toBe(6);
    const body = await gunzipped(ready.body);
    expect(body.split("\n")).toHaveLength(7);
    expect(body).toContain("I drew the layout on paper first, because that is how I think.");
    for (const absent of ["environment_context", "AGENTS.md", "## My request", "Here is a gentler reminder schedule", "rm -rf build"]) {
      expect(body).not.toContain(absent);
    }
  });

  it("D9-T3: an export with no own turns is refused before any body exists", async () => {
    stages.length = 0;
    const file = new File(['[{"messages":[{"role":"assistant","content":"Hello there."}]}]'], "conversations.json");
    const result = await run({ kind: "file", file });
    expect(result).toEqual({
      ok: false,
      code: "source_no_own_turns",
      message:
        "No messages written by you were found in this file. Pick the export file itself (conversations.json inside the zip), or paste some notes instead.",
    });
    expect("body" in result).toBe(false);
  });

  it("R3.8-T6: the code-only export is flagged as low signal", async () => {
    stages.length = 0;
    const ready = readyOf(await run({ kind: "file", file: new File([codeOnlyText], "conversations.json") }));
    expect(ready.personaSignal).toBe(0.115);
    expect(ready.isLowSignal).toBe(true);
    expect(ready.keptTurns).toBe(30);
  });

  it("A3-T2: a paste reports four stages in order and previews 1 redaction", async () => {
    stages.length = 0;
    const ready = readyOf(await run({ kind: "paste", text: pasteText }));
    expect(stages.map((progress) => progress.stage)).toEqual(["reading", "parsing", "scrubbing", "compressing"]);
    expect(ready.header.kind).toBe("paste");
    expect(ready.keptTurns).toBe(8);
    expect(ready.previewRedactionCount).toBe(1);
    expect(stages.every((progress) => progress.inflatedBytes === 0)).toBe(true);
  });

  it("R1.1-T24: a JSON file that does not parse is refused with source_file_not_json", async () => {
    stages.length = 0;
    const result = await run({ kind: "file", file: new File(["{nope"], "conversations.json") });
    expect(result).toMatchObject({
      ok: false,
      code: "source_file_not_json",
      message: "This file is not a JSON export. Pick conversations.json from the zip, or paste text.",
    });
  });

  it("D1-T2: an unexpected read error becomes file_unreadable (uses a fake file)", async () => {
    stages.length = 0;
    const fake = {
      size: 10,
      name: "notes.md",
      slice: () => new Blob(["# no"]),
      arrayBuffer: () => Promise.reject(new TypeError("gone")),
    } as unknown as File;
    const result = await run({ kind: "file", file: fake });
    expect(result).toEqual({ ok: false, code: "file_unreadable", message: FILE_UNREADABLE_SENTENCE });
  });
});

describe("toRefusal", () => {
  it("D1-T3: toRefusal keeps a known refusal and replaces anything else", () => {
    expect(toRefusal(new ContractError("zip_too_large", "s", 413))).toEqual({ ok: false, code: "zip_too_large", message: "s" });
    expect(toRefusal(new ContractError("payload_invalid", "x", 400))).toEqual({
      ok: false,
      code: "file_unreadable",
      message: FILE_UNREADABLE_SENTENCE,
    });
    expect(toRefusal("boom")).toEqual({ ok: false, code: "file_unreadable", message: FILE_UNREADABLE_SENTENCE });
  });

  it("D1-T4: the handler is not installed outside a worker", () => {
    installWorkerHandler();
    expect((globalThis as unknown as Record<string, unknown>).onmessage).toBeUndefined();
  });
});
