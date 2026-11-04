import { describe, expect, it, vi, beforeAll } from "vitest";
import { strToU8, zipSync } from "fflate";
import chatgpt2024Text from "../../../../packages/parsers/fixtures/chatgpt-2024-mapping.json?raw";
import chatgpt2026Text from "../../../../packages/parsers/fixtures/chatgpt-2026-messages.json?raw";
import codexText from "../../../../packages/parsers/fixtures/codex-session.jsonl?raw";
import {
  INFLATE_SLICE_BYTES,
  INFLATED_MAX_BYTES,
  readPickedFile,
  readZipEntries,
  ZIP_MAX_BYTES,
  ZIP_SIGNATURE,
  type ReadOptions,
} from "./zip-stream.js";

const options: ReadOptions = { inflatedCapBytes: INFLATED_MAX_BYTES, onInflated: () => undefined };

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

// Returns the error a promise rejected with, or undefined when it resolved.
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("readPickedFile", () => {
  it("D2-T1: a file over 150 MB is refused before any byte is read (uses a fake file)", async () => {
    const slice = vi.fn();
    const stream = vi.fn();
    const arrayBuffer = vi.fn();
    const fake = {
      size: 150_000_001,
      name: "big.zip",
      slice,
      stream,
      arrayBuffer,
    } as unknown as File;
    await expect(readPickedFile(fake, options)).rejects.toMatchObject({ code: "zip_too_large" });
    expect(slice).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("R1.3-T1: a zip is found by its first bytes whatever its name", async () => {
    const zip = zipSync({ "conversations.json": strToU8(chatgpt2024Text) });
    const file = new File([zip], "export.dat");
    await expect(readPickedFile(file, options)).resolves.toEqual([
      { name: "conversations.json", text: chatgpt2024Text },
    ]);
  });

  it("R1.3-T2: a file that is neither a zip nor .json, .md or .txt is unreadable, and a .md file is read as text", async () => {
    await expect(readPickedFile(new File(["hello"], "x.exe"), options)).rejects.toMatchObject({
      code: "file_unreadable",
    });
    await expect(
      readPickedFile(new File(["# Notes\n\nOne."], "notes.md"), options),
    ).resolves.toEqual([{ name: "notes.md", text: "# Notes\n\nOne." }]);
  });

  it("R1.3-T3: a picked Codex .jsonl file is read keeping only the lines the Codex reader wants", async () => {
    const picked = await readPickedFile(
      new File([codexText], "rollout-2026-10-02T08-00-00.jsonl"),
      options,
    );
    expect(picked.map((entry) => entry.name)).toEqual(["rollout-2026-10-02T08-00-00.jsonl"]);
    const lines = itemAt(picked, 0).text.split("\n");
    expect(lines).toHaveLength(16);
    expect(lines.join("\n")).not.toContain("Here is a gentler reminder schedule");
    expect(lines.join("\n")).not.toContain("item_completed");
  });
});

describe("readZipEntries entry choice", () => {
  it("R1.1-T23: conversations.json wins inside a zip, and without it every .json, .md and .txt entry is read", async () => {
    const withConversations = zipSync({
      "conversations.json": strToU8(chatgpt2026Text),
      "user.json": strToU8("{}"),
      "dalle/a.png": new Uint8Array([1, 2, 3, 4]),
    });
    const picked = await readZipEntries(new Blob([withConversations]), options);
    expect(picked).toEqual([{ name: "conversations.json", text: chatgpt2026Text }]);

    const withoutConversations = zipSync({
      "notes/today.md": strToU8("Note one."),
      "__MACOSX/._today.md": strToU8("x"),
      "image.png": new Uint8Array([1, 2, 3, 4]),
      "readme.txt": strToU8("Second."),
    });
    const others = await readZipEntries(new Blob([withoutConversations]), options);
    expect(others.map((entry) => entry.name)).toEqual(["notes/today.md", "readme.txt"]);
  });

  it("R1.1-T39: a zip of Codex sessions reads every .jsonl entry with only its wanted lines, and skips compressed .jsonl.zst entries", async () => {
    const zip = zipSync({
      "sessions/2026/10/02/rollout-a.jsonl": strToU8(codexText),
      "sessions/2026/10/01/rollout-b.jsonl": strToU8('{"type":"turn_context","payload":{}}'),
      "sessions/2026/09/01/rollout-c.jsonl.zst": new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]),
    });
    const entries = await readZipEntries(new Blob([zip]), options);
    expect(entries.map((entry) => entry.name)).toEqual([
      "sessions/2026/10/02/rollout-a.jsonl",
      "sessions/2026/10/01/rollout-b.jsonl",
    ]);
    expect(itemAt(entries, 0).text.split("\n")).toHaveLength(16);
    expect(itemAt(entries, 0).text).not.toContain("Here is a gentler reminder schedule");
    expect(itemAt(entries, 1).text).toBe("");
  });
});

describe("readZipEntries inflation cap", () => {
  const seen: number[] = [];
  let failure: unknown;
  let elapsedMs = Number.POSITIVE_INFINITY;

  beforeAll(async () => {
    const zip = zipSync({ "conversations.json": new Uint8Array(67_108_864) });
    const start = performance.now();
    failure = await rejectionOf(
      readZipEntries(new Blob([zip]), {
        inflatedCapBytes: 16_777_216,
        onInflated: (bytes) => seen.push(bytes),
      }),
    );
    elapsedMs = performance.now() - start;
  });

  it("D3-T1: a zip whose entry inflates past the cap is refused within 2 seconds (the cap lowered to 16 MiB for the test)", () => {
    expect(failure).toMatchObject({ code: "zip_inflated_too_large" });
    expect(elapsedMs).toBeLessThan(2000);
  });

  it("R1.2-T1: inflation stops within 4,227,072 bytes past the cap", () => {
    const last = itemAt(seen, seen.length - 1);
    expect(last).toBeLessThanOrEqual(16_777_216 + 4_227_072);
  });

  it("D3-T2: the caps are the decimal values of D2 and D3", () => {
    expect(ZIP_MAX_BYTES).toBe(150_000_000);
    expect(INFLATED_MAX_BYTES).toBe(1_500_000_000);
    expect(INFLATE_SLICE_BYTES).toBe(4_096);
    expect([...ZIP_SIGNATURE]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
