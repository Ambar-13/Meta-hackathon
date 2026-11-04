import { describe, expect, it, vi } from "vitest";
import type { SourceHeader, Turn } from "@meet-first/contracts";
import { rankAndCut } from "@meet-first/parsers";
import { buildNdjson, encodeUploadBody } from "./upload-body.js";
import { scrubForUpload } from "./scrub-preview.js";

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

const header: SourceHeader = {
  kind: "paste",
  parserVersion: "1",
  scrubVersion: "1",
  personaSignal: 0.5,
  attested: true,
  turnCount: 2,
};

// Builds the turns a source holds from plain texts, numbered in order.
function turnsOf(texts: string[]): Turn[] {
  return texts.map((text, index) => ({
    turnIndex: index,
    role: "user",
    text,
    lang: "en",
    sensitiveCategories: [],
  }));
}

// Gunzips a blob through the browser decompressor and returns its text.
async function gunzipped(body: Blob): Promise<string> {
  return new Response(body.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

describe("encodeUploadBody", () => {
  it("D4-T1: the body is gzip when CompressionStream exists and inflates back to the NDJSON", async () => {
    const turns = turnsOf(["First line.", "Second line."]);
    const ndjson = buildNdjson(header, turns);
    const encoded = await encodeUploadBody(ndjson);
    expect(encoded.contentEncoding).toBe("gzip");
    expect(await gunzipped(encoded.body)).toBe(ndjson);
    expect(encoded.decodedBytes).toBe(new TextEncoder().encode(ndjson).length);
    expect(encoded.encodedBytes).toBe(encoded.body.size);
  });

  it("D4-T2: without CompressionStream the body is the plain NDJSON (CompressionStream stubbed away)", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    try {
      const ndjson = buildNdjson(header, turnsOf(["First line.", "Second line."]));
      const encoded = await encodeUploadBody(ndjson);
      expect(encoded.contentEncoding).toBeNull();
      expect(await encoded.body.text()).toBe(ndjson);
      expect(encoded.body.type).toBe("application/x-ndjson");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("D4-T3: more than 20,971,520 bytes of NDJSON is refused", async () => {
    await expect(encodeUploadBody("a".repeat(20_971_521))).rejects.toMatchObject({
      code: "upload_too_large",
    });
  });

  it("D4-T4: a body over 8,388,608 bytes after gzip is refused", async () => {
    const count = 11_000_000;
    const random = new Uint8Array(count);
    for (let offset = 0; offset < count; offset += 65_536) {
      crypto.getRandomValues(random.subarray(offset, Math.min(offset + 65_536, count)));
    }
    const alphabet: number[] = [];
    for (let code = 0x21; code <= 0x7e; code += 1) {
      if (code !== 0x22 && code !== 0x5c) alphabet.push(code);
    }
    const codes = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      codes[index] = itemAt(alphabet, itemAt(random, index) % alphabet.length);
    }
    const text = new TextDecoder().decode(codes);
    await expect(encodeUploadBody(text)).rejects.toMatchObject({ code: "upload_too_large" });
  }, 60_000);
});

describe("buildNdjson", () => {
  it("D4-T5: buildNdjson writes the header line, one line per turn and no final newline", () => {
    const turns = turnsOf(["First line.", "Second line."]);
    const ndjson = buildNdjson(header, turns);
    const lines = ndjson.split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(itemAt(lines, 0))).toEqual(header);
    expect((JSON.parse(itemAt(lines, 2)) as { text: string }).text).toBe("Second line.");
    expect(ndjson.endsWith("\n")).toBe(false);
  });
});

describe("the 400 MB export", () => {
  it("R1.4-T1: 400 MB of own turns gives a gzip body under 2 MiB (generated, 60 s timeout)", async () => {
    const bases = Array.from({ length: 50 }, (entry, index) =>
      `I walked to the market on day ${String(index)} and bought bread. `
        .repeat(500)
        .slice(0, 20_000),
    );
    const raw = Array.from({ length: 20_000 }, (entry, index) => {
      const text = itemAt(bases, index % 50);
      return { text, exportOrder: index, createTime: null, canonical: text };
    });
    const kept = rankAndCut(raw);
    expect(kept.length).toBe(104);
    expect(itemAt(kept, 0).exportOrder).toBe(19_896);
    const preview = scrubForUpload(
      kept.map((turn, index) => ({
        turnIndex: index,
        role: "user",
        text: turn.canonical,
        lang: "en",
        sensitiveCategories: [],
      })),
      [],
    );
    const encoded = await encodeUploadBody(
      buildNdjson({ ...header, turnCount: preview.turns.length }, preview.turns),
    );
    expect(encoded.encodedBytes).toBeLessThan(2_097_152);
  }, 60_000);
});
