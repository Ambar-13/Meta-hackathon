// Turns a meeting's turns, claims and approved items into the brief prompt, and the model's lines into checked brief points.
import type { QuestionKind, BriefOutput, BriefPoint, Claim } from "@meet-first/contracts";
import type { ChatMessage } from "@meet-first/llm";
import { verifyQuote } from "@meet-first/receipts";

// The number of lines in each of the three sections of a brief.
export const LINES_PER_SECTION = 3;
// The id a quote carries when the turn it names is not in the notes. The screen treats it as no receipt.
export const UNKNOWN_TURN_ID = "00000000-0000-0000-0000-000000000000";

// One side of the meeting as the brief sees it: the side letter, the owner, the name shown and the card.
export type BriefSide = { side: "a" | "b"; personId: string; displayName: string; cardId: string };
// One turn of a person's notes, as a brief quote names it: its id, its side, its index in the notes and its text.
export type SourceTurn = {
  id: string;
  side: "a" | "b";
  personId: string;
  turnIndex: number;
  text: string;
  normText: string;
};
// One approved card item of a side, with the turn it quotes.
export type ApprovedItem = {
  side: "a" | "b";
  position: number;
  kind: string;
  claim: string;
  lang: string;
  quote: string;
  turnId: string;
  verified: boolean;
};
// One committed meeting turn with its claims, as the transcript shows it.
export type TranscriptTurn = {
  stepSeq: number;
  side: "a" | "b";
  phase: string;
  text: string;
  claims: Claim[];
};
// One quote the brief may copy: the side and turn it names, its text, and whether it came from a claim or an item.
export type CitableQuote = {
  side: "a" | "b";
  turnId: string;
  text: string;
  origin: "claim" | "item";
};
// Everything one recipient's brief prompt is built from.
export type BriefPromptInput = {
  recipient: BriefSide;
  other: BriefSide;
  questionText: string;
  questionKind: QuestionKind;
  sourceTurns: SourceTurn[];
  transcript: TranscriptTurn[];
  items: ApprovedItem[];
  promptText: string;
  untrustedRulesText: string;
};
// The three sections of one brief, each a list of points.
export type BriefSections = { agree: BriefPoint[]; clash: BriefPoint[]; decideFirst: BriefPoint[] };

// The label a note turn has in the prompt: t: and its index in the notes, the same short form as the meeting turn labels.
export function sourceTurnLabel(turnIndex: number): string {
  return `t:${String(turnIndex)}`;
}

// Reads a turn label back to its index in the notes, or null when the text is not a turn label.
export function parseSourceTurnLabel(label: string): number | null {
  const text = label.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/^t:/, "");
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

// The prompt text without the status comment on its first line, which speaks to the people who keep the prompt, not the model.
export function promptBodyOf(text: string): string {
  return text.replace(/^<!--[^\n]*-->\n?/, "");
}

// What the prompt lines need to name a note turn and to collect the quotes the brief may copy.
type PromptContext = { turnIndexById: Map<string, number>; citable: CitableQuote[] };

// The lines of one card: one line per verified item that names a turn in the notes, in position order.
function cardLines(side: "a" | "b", items: ApprovedItem[], context: PromptContext): string[] {
  const lines = [`<card side="${side}">`];
  for (const item of items
    .filter((candidate) => candidate.side === side && candidate.verified)
    .sort((x, y) => x.position - y.position)) {
    const index = context.turnIndexById.get(item.turnId);
    if (index === undefined) continue;
    context.citable.push({ side, turnId: item.turnId, text: item.quote, origin: "item" });
    lines.push(
      `[item ${side}-${String(item.position)}] kind=${item.kind} claim=${item.claim} | quote="${item.quote}" | turn=${sourceTurnLabel(index)} | lang=${item.lang}`,
    );
  }
  lines.push("</card>");
  return lines;
}

// The lines of the transcript: each turn, then its claims. A claim is citable only when its quote verified.
function transcriptLines(transcript: TranscriptTurn[], context: PromptContext): string[] {
  const lines = ["<transcript>"];
  for (const turn of [...transcript].sort((x, y) => x.stepSeq - y.stepSeq)) {
    lines.push(
      `[turn ${String(turn.stepSeq)} | side ${turn.side} | ${turn.phase}] ${turn.text.trimEnd()}`,
    );
    for (const claim of [...turn.claims].sort((x, y) => x.position - y.position)) {
      lines.push(claimLine(turn.stepSeq, claim, context));
    }
  }
  lines.push("</transcript>");
  return lines;
}

// One claim line of the transcript, and the citable entry when the claim verified inside a known note.
function claimLine(stepSeq: number, claim: Claim, context: PromptContext): string {
  const index = context.turnIndexById.get(claim.turnId);
  const isCitable = claim.verified && index !== undefined;
  if (isCitable)
    context.citable.push({
      side: claim.side,
      turnId: claim.turnId,
      text: claim.quote,
      origin: "claim",
    });
  const status = isCitable ? "verified" : "no receipt";
  const label = index === undefined ? "none" : sourceTurnLabel(index);
  const gloss = claim.gloss === undefined ? "" : ` | gloss=${claim.gloss}`;
  return `  [claim ${String(stepSeq)}-${String(claim.position)} | ${status}] "${claim.quote}" | side=${claim.side} | turn=${label}${gloss}`;
}

// Builds the two messages of one recipient's brief call and the quotes it may copy.
export function buildBriefPromptInput(input: BriefPromptInput): {
  messages: ChatMessage[];
  citable: CitableQuote[];
} {
  const context: PromptContext = {
    turnIndexById: new Map(input.sourceTurns.map((turn) => [turn.id, turn.turnIndex])),
    citable: [],
  };
  const people =
    input.recipient.side === "a" ? [input.recipient, input.other] : [input.other, input.recipient];
  const system = promptBodyOf(input.promptText)
    .replaceAll("{{untrusted_data_rules}}", input.untrustedRulesText)
    .replaceAll("{{recipient_side}}", input.recipient.side);
  const body = [
    `<question kind="${input.questionKind}">${input.questionText}</question>`,
    `<people>${people.map((person) => `side ${person.side}: ${person.displayName}`).join("; ")}; you are writing for side ${input.recipient.side}</people>`,
    ...cardLines("a", input.items, context),
    ...cardLines("b", input.items, context),
    ...transcriptLines(input.transcript, context),
    `You may cite ${String(context.citable.length)} quotes. Copy them exactly.`,
  ];
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: body.join("\n") },
    ],
    citable: context.citable,
  };
}

// What a quote check needs: the notes by side and index, the owners by side, and the question the quote must not copy.
type CheckContext = {
  notes: Map<string, SourceTurn>;
  personBySide: Record<"a" | "b", string>;
  questionText: string;
};

// Checks one quote the model returned against the note it names, and the person who owns that note.
function checkQuote(
  quote: BriefOutput["agree"][number]["quotes"][number],
  context: CheckContext,
): BriefPoint["quotes"][number] {
  const index = parseSourceTurnLabel(quote.turn_id);
  const turn = index === null ? undefined : context.notes.get(`${quote.side}:${String(index)}`);
  if (turn === undefined)
    return { text: quote.text, side: quote.side, turnId: UNKNOWN_TURN_ID, verified: false };
  const check = verifyQuote({
    quote: quote.text,
    turnText: turn.text,
    turnNormText: turn.normText,
    forbidden: [context.questionText],
  });
  return {
    text: quote.text,
    side: quote.side,
    turnId: turn.id,
    verified: check.ok && turn.personId === context.personBySide[quote.side],
  };
}

// Turns the model's three sections into brief points, each quote checked inside its named note. Nothing else changes.
export function verifyBriefQuotes(input: {
  output: BriefOutput;
  sourceTurns: SourceTurn[];
  personBySide: Record<"a" | "b", string>;
  questionText: string;
}): BriefSections {
  const context: CheckContext = {
    notes: new Map(
      input.sourceTurns.map((turn) => [`${turn.side}:${String(turn.turnIndex)}`, turn]),
    ),
    personBySide: input.personBySide,
    questionText: input.questionText,
  };
  const toPoint = (point: BriefOutput["agree"][number]): BriefPoint => ({
    text: point.text,
    quotes: point.quotes.map((quote) => checkQuote(quote, context)),
    supported: null,
  });
  return {
    agree: input.output.agree.map(toPoint),
    clash: input.output.clash.map(toPoint),
    decideFirst: input.output.decide_first.map(toPoint),
  };
}
