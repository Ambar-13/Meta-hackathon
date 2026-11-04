import { describe, expect, it } from "vitest";
import codexText from "../../../../packages/parsers/fixtures/codex-session.jsonl?raw";
import { collectorFor, wantedLines, type TextCollector } from "./text-collectors.js";

// Pushes the bytes of a text into a collector in slices that end at the given offsets, then returns
// what the collector gives back.
function collectInSlices(collector: TextCollector, text: string, cuts: number[]): string {
  const bytes = new TextEncoder().encode(text);
  let start = 0;
  for (const end of [...cuts, bytes.length]) {
    collector.push(bytes.subarray(start, end));
    start = end;
  }
  return collector.finish();
}

describe("wantedLines", () => {
  it("R1.1-T37: joins a line split across chunks, even between the bytes of one character, and keeps a last line with no line break", () => {
    const collector = wantedLines((line) => line.startsWith("keep"));
    // Byte 9 falls between the two bytes of the "é" in "café".
    expect(collectInSlices(collector, "keep café\nskip this one\nkeep the end", [3, 9, 15])).toBe(
      "keep café\nkeep the end",
    );
  });
});

describe("collectorFor", () => {
  it("R1.1-T38: keeps every byte of a .json file and only the Codex reader's lines of a .jsonl file", () => {
    const json = '{"messages": []}\n{"second": true}';
    expect(collectInSlices(collectorFor("conversations.json"), json, [5])).toBe(json);
    const kept = collectInSlices(
      collectorFor("sessions/2026/10/02/rollout.JSONL"),
      codexText,
      [100, 2000],
    ).split("\n");
    expect(kept).toHaveLength(16);
    expect(
      kept.every(
        (line) => line.includes('"type":"session_meta"') || line.includes('"role":"user"'),
      ),
    ).toBe(true);
    expect(kept.join("\n")).not.toContain("Here is a gentler reminder schedule");
  });
});
