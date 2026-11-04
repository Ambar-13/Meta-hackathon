// The blind, order-flipped support check: builds the judge's input, maps its verdicts back by index, and gives the support rate.
import { createHash } from "node:crypto";
import type { BriefPoint, BriefSupportJudgeOutput } from "@meet-first/contracts";
import type { ChatMessage } from "@meet-first/llm";
import { escapeBlockText } from "../meetings/prompt-builder.js";
import { LINES_PER_SECTION, promptBodyOf, type BriefSections } from "./brief-lines.js";

// The most characters one judge reason keeps on a line (the contract's reason limit).
export const REASON_MAX_CHARS = 200;
// The three section names, in the order their indexes run.
const SECTION_KEYS = ["agree", "clash", "decideFirst"] as const;
// Decimal places the support rate keeps.
const RATE_SCALE = 1000;

// One line as the judge sees it: its original index, whether its quote comes before its statement, and the line itself.
type JudgeSlot = { index: number; isFlipped: boolean; point: BriefPoint };

// The points of a brief in index order: agree 0 to 2, clash 3 to 5, decide first 6 to 8.
export function pointsInIndexOrder(sections: BriefSections): BriefPoint[] {
  return [...sections.agree, ...sections.clash, ...sections.decideFirst];
}

// The seeded random source: mulberry32 over the first 32 bits of sha256(seed). The same seed always gives the same numbers.
export function makeSeededRandom(seed: string): () => number {
  const digest = createHash("sha256").update(seed).digest();
  let state = digest.readUInt32BE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Whether one line's quote comes before its statement to the judge: the first byte of sha256(line text, newline, quote text) is odd.
export function isFlippedLine(point: BriefPoint): boolean {
  const quoteText = point.quotes.map((quote) => quote.text).join("\n");
  const digest = createHash("sha256").update(`${point.text}\n${quoteText}`).digest();
  return (digest[0] ?? 0) % 2 === 1;
}

// The indexes 0 to count minus 1 in a seeded shuffled order (Fisher-Yates from the end).
function shuffledIndexes(count: number, random: () => number): number[] {
  const order = Array.from(Array(count).keys());
  for (let position = count - 1; position > 0; position -= 1) {
    const other = Math.floor(random() * (position + 1));
    const current = order[position] ?? position;
    order[position] = order[other] ?? other;
    order[other] = current;
  }
  return order;
}

// The judge's text for one line: the statement and its quotes, in the order the flip gives. Both are escaped, as every block text
// is, so a line or a quote cannot close its item and open another.
function slotBlock(slot: JudgeSlot): string[] {
  const quotes = slot.point.quotes.map(
    (quote) => `<quote>"${escapeBlockText(quote.text)}"</quote>`,
  );
  const statement = `<statement>${escapeBlockText(slot.point.text)}</statement>`;
  const body = slot.isFlipped ? [...quotes, statement] : [statement, ...quotes];
  return [`<item index="${String(slot.index)}">`, ...body, "</item>"];
}

// The seed of one brief's shuffle: its side and the words of its nine lines. No id or clock goes in, so the same lines always give the same request.
export function judgeSeedOf(side: "a" | "b", points: BriefSections): string {
  const lines = pointsInIndexOrder(points).map(
    (point) => `${point.text}\n${point.quotes.map((quote) => quote.text).join("\n")}`,
  );
  return `${side}\n${lines.join("\n")}`;
}

// Builds the judge's messages for one brief: nine lines, shuffled and flipped by seeded rules, with no section names.
export function buildJudgeInput(input: {
  side: "a" | "b";
  points: BriefSections;
  promptText: string;
}): { messages: ChatMessage[]; order: number[]; flipped: boolean[] } {
  const points = pointsInIndexOrder(input.points);
  const random = makeSeededRandom(judgeSeedOf(input.side, input.points));
  const order = shuffledIndexes(points.length, random);
  const flipped = points.map((point) => isFlippedLine(point));
  const slots: JudgeSlot[] = points.map((point, index) => ({
    index,
    isFlipped: flipped[index] === true,
    point,
  }));
  const shown = order
    .map((index) => slots[index])
    .filter((slot): slot is JudgeSlot => slot !== undefined);
  const user = ["<items>", ...shown.flatMap(slotBlock), "</items>"].join("\n");
  return {
    messages: [
      { role: "system", content: promptBodyOf(input.promptText) },
      { role: "user", content: user },
    ],
    order,
    flipped,
  };
}

// Writes the judge's verdicts onto the points by their original index. Unknown indexes are dropped; for a repeated index the last verdict wins.
export function applyJudgeOutput(
  sections: BriefSections,
  output: BriefSupportJudgeOutput,
): BriefSections {
  let next = sections;
  for (const line of output.lines) {
    next = setVerdict(next, {
      index: line.index,
      supported: line.supported,
      reason: line.reason.slice(0, REASON_MAX_CHARS),
    });
  }
  return next;
}

// One verdict as the judge gives it, with the index of the line it judges.
type Verdict = { index: number; supported: boolean; reason: string };

// Sets one line's verdict and reason, or returns the sections unchanged when the index names no line.
function setVerdict(sections: BriefSections, verdict: Verdict): BriefSections {
  const key = SECTION_KEYS[Math.floor(verdict.index / LINES_PER_SECTION)];
  const position = verdict.index % LINES_PER_SECTION;
  if (key === undefined || verdict.index < 0) return sections;
  const list = sections[key];
  if (list[position] === undefined) return sections;
  const updated = list.map((point, at) =>
    at === position
      ? { ...point, supported: verdict.supported, supportReason: verdict.reason }
      : point,
  );
  return { ...sections, [key]: updated };
}

// The support rate: supported lines over the lines that carry a quote, to three decimals; null when no line has a quote.
export function computeSupportRate(sections: BriefSections): number | null {
  const withQuote = pointsInIndexOrder(sections).filter((point) => point.quotes.length > 0);
  if (withQuote.length === 0) return null;
  const supported = withQuote.filter((point) => point.supported === true).length;
  return Math.round((supported / withQuote.length) * RATE_SCALE) / RATE_SCALE;
}
