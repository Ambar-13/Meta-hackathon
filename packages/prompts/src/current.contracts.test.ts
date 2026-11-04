import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BriefOutput,
  CardBuildOutput,
  MODEL_OUTPUT_SCHEMAS,
  NamesPassOutput,
  QUIZ_BANK,
  QuestionCheckOutput,
  toStrictJsonSchema,
} from "@meet-first/contracts";
import { PROMPT_NAMES, currentVersion, promptFilePath, readPrompt } from "./index.js";

// The system message the card call sends: the dossier prompt, then the untrusted-data rules.
const cardSystemText = `${readPrompt("dossier").text}\n\n${readPrompt("untrusted-data-rules").text}`;

// Visits every object and array member under a JSON node, with the depth of its containers.
function walk(
  node: unknown,
  depth: number,
  visit: (node: Record<string, unknown>, depth: number) => void,
): number {
  if (Array.isArray(node))
    return Math.max(depth, ...node.map((child) => walk(child, depth + 1, visit)));
  if (typeof node !== "object" || node === null) return depth;
  const record = node as Record<string, unknown>;
  visit(record, depth);
  const children = Object.values(record).filter(
    (child) => typeof child === "object" && child !== null,
  );
  return Math.max(depth, ...children.map((child) => walk(child, depth + 1, visit)));
}

describe("schema files", () => {
  it("R3.1-T4: the schema.json of every current version under packages/prompts is strict", () => {
    for (const name of Object.keys(MODEL_OUTPUT_SCHEMAS) as (keyof typeof MODEL_OUTPUT_SCHEMAS)[]) {
      const file = JSON.parse(
        readFileSync(promptFilePath(name, currentVersion(name), "schema.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(file.strict).toBe(true);
      expect(file.name).toBe(name);
      let combinators = 0;
      let looseObjects = 0;
      const depth = walk(file.schema, 0, (node) => {
        if ("anyOf" in node || "oneOf" in node || "allOf" in node) combinators += 1;
        if (node.type === "object") {
          const properties = Object.keys(
            (node.properties as Record<string, unknown> | undefined) ?? {},
          );
          const required = (node.required as string[] | undefined) ?? [];
          if (
            node.additionalProperties !== false ||
            JSON.stringify(required) !== JSON.stringify(properties)
          )
            looseObjects += 1;
        }
      });
      expect(combinators).toBe(0);
      expect(looseObjects).toBe(0);
      expect(depth).toBeLessThanOrEqual(10);
    }
  });

  it("R3.1-T5: the dossier, scrub-names, question-check and brief schemas read by readPrompt are the converted contracts schemas", () => {
    expect(readPrompt("dossier").schema).toEqual(toStrictJsonSchema(CardBuildOutput, "dossier"));
    expect(readPrompt("scrub-names").schema).toEqual(
      toStrictJsonSchema(NamesPassOutput, "scrub-names"),
    );
    expect(readPrompt("question-check").schema).toEqual(
      toStrictJsonSchema(QuestionCheckOutput, "question-check"),
    );
    expect(readPrompt("brief").schema).toEqual(toStrictJsonSchema(BriefOutput, "brief"));
    expect(readPrompt("untrusted-data-rules").schema).toBeNull();
  });
});

describe("prompt texts", () => {
  it("R4.1-T1: the card prompt holds no quiz text", () => {
    for (const question of QUIZ_BANK) expect(cardSystemText.includes(question.text)).toBe(false);
    expect(/quiz/i.test(cardSystemText)).toBe(false);
  });

  it("R3.8-T1: the card prompt keeps a code-heavy export to its personal statements", () => {
    const text = readPrompt("dossier").text;
    expect(text).toContain(
      "When the messages are mostly code questions, task requests or small talk, still return 6 items",
    );
    expect(text).toContain("Never invent a quote to reach 6.");
  });

  it("R3.9-T2: current.ts names every prompt folder, the question-kind prompts at v5, v4 or v2, persona-answer at v2 and the rest at v1, and readPrompt reads that version", () => {
    expect(PROMPT_NAMES).toEqual([
      "dossier",
      "scrub-names",
      "question-check",
      "quiz-persona-answer",
      "quiz-judge",
      "meeting-moderator",
      "meeting-speech",
      "meeting-receipts",
      "brief",
      "brief-support-judge",
      "comic-panels",
      "comic-image",
      "untrusted-data-rules",
      "persona-answer",
      "orchestrator",
      "summary-request",
      "search-words",
    ]);
    const changed: Record<string, string> = {
      "question-check": "v5",
      "meeting-moderator": "v5",
      "meeting-speech": "v2",
      brief: "v5",
      "brief-support-judge": "v2",
      orchestrator: "v3",
      "persona-answer": "v2",
    };
    for (const name of PROMPT_NAMES) expect(currentVersion(name)).toBe(changed[name] ?? "v1");
    for (const name of [
      "dossier",
      "scrub-names",
      "untrusted-data-rules",
      "question-check",
      "meeting-moderator",
      "meeting-speech",
    ] as const) {
      const prompt = readPrompt(name);
      expect(prompt.version).toBe(currentVersion(name));
      expect(prompt.text.startsWith("<version>")).toBe(true);
      expect(prompt.text).toContain("Status: draft");
    }
  });

  it("R7.3-T1: the untrusted-data rules name every container the prompts use", () => {
    const text = readPrompt("untrusted-data-rules").text;
    for (const container of [
      "<source_turns>",
      "<allowlist>",
      "<failed_items>",
      "<other_persona>",
      "<recall_result>",
      "<human_answer>",
    ]) {
      expect(text).toContain(container);
    }
  });

  it("R2.3-T10: the scrub-names prompt puts the allowlist before every other rule", () => {
    expect(readPrompt("scrub-names").text).toContain(
      "<allowlist> comes before every other rule: its entries are never returned.",
    );
  });
});
