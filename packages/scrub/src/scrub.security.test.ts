import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Category } from "@meet-first/contracts";
import { scrub } from "./scrub.js";

// One planted secret: the sentence that holds it, the exact secret, and the one category its redaction must carry.
const PlantedLine = z.object({ category: Category, text: z.string(), secret: z.string() });

// Reads and parses the 40 planted secrets, one JSON object per line.
async function plantedLines(): Promise<z.infer<typeof PlantedLine>[]> {
  const raw = await readFile(new URL("../fixtures/planted-secrets.ndjson", import.meta.url), "utf8");
  const lines = raw.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => PlantedLine.parse(JSON.parse(line)));
}

describe("scrub against the planted secrets", () => {
  it("R2.2-T15: none of the 40 planted secrets survives", async () => {
    const lines = await plantedLines();
    const survivors = lines.filter((line) => scrub(line.text, { allowlist: [] }).text.includes(line.secret)).length;
    expect(lines.length).toBe(40);
    expect(survivors).toBe(0);
    console.log(`planted ${String(lines.length)}, survived ${String(survivors)}`);
  });

  it("R2.2-T16: each planted secret gives exactly one redaction of its category", async () => {
    for (const line of await plantedLines()) {
      const categories = scrub(line.text, { allowlist: [] }).redactions.map((redaction) => redaction.category);
      expect(categories).toEqual([line.category]);
    }
  });

  it("R2.2-T17: the ordinary prose fixture passes untouched", async () => {
    const text = await readFile(new URL("../fixtures/ordinary-prose.txt", import.meta.url), "utf8");
    expect(scrub(text, { allowlist: [] })).toEqual({ text, redactions: [] });
  });

  it("R2.1-T2: any planted text inside a fence leaves nothing behind", async () => {
    for (const line of await plantedLines()) {
      const fenced = scrub("```\n" + line.text + "\n```", { allowlist: [] }).text;
      expect(fenced).toBe("[code: text, " + String(line.text.split("\n").length) + " lines]");
    }
  });
});
