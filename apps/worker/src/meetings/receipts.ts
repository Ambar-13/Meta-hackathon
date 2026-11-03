import { ReceiptsOutput } from "@meet-first/contracts";
import { verifyQuote } from "@meet-first/receipts";
import type { ChatMessage } from "@meet-first/llm";
import { turnLabel } from "./prompt-builder.js";

// One turn of the speaking side that a claim may cite: shown to the model as a card quote or a recall result.
export type CitableTurn = { turnId: string; turnIndex: number; text: string; normText: string };
// What the receipts request shows: the speech, the card quotes and this step's recall results of the speaking side.
export type ReceiptsInput = {
  side: "a" | "b"; speechText: string;
  cardQuotes: ReadonlyArray<{ turnIndex: number; quote: string; claim: string }>;
  recallTurns: ReadonlyArray<{ turnIndex: number; text: string }>;
};
// Why a claim failed its check, in the order the checks run.
export type ClaimFailure = "unknown_turn" | "too_short" | "substring_of_prompt" | "not_in_turn";
// One claim after its check. turnId is null only for unknown_turn.
export type CheckedClaim = { text: string; quote: string; lang: string; gloss: string; label: string; turnId: string | null; failure: ClaimFailure | null };
// One claim ready to store; regenerated is true when it came from the second receipts call.
export type StoredClaim = { text: string; quote: string; lang: string; gloss: string; turnId: string; isVerified: boolean; isRegenerated: boolean };
// The injected receipts call: sends the messages with the strict receipts schema and returns the parsed JSON.
export type ReceiptsCallFn = (messages: ChatMessage[]) => Promise<unknown>;

// One failed claim as the regeneration message names it: its 0-based index and why it failed.
type FailedClaim = { index: number; failure: ClaimFailure | "schema" };
// The claims to store and the number dropped, with how many receipts calls ran.
type ReceiptsRun = { claims: StoredClaim[]; droppedCount: number; callCount: 1 | 2 };

// The words that tell the model why a claim failed, one per failure.
const FAILURE_WORDS: Readonly<Record<ClaimFailure | "schema", string>> = {
  unknown_turn: "it names a turn that is not in the lists",
  too_short: "the quote is shorter than 20 characters, or 10 for text without spaces",
  substring_of_prompt: "the quote repeats the instructions or the meeting question",
  not_in_turn: "the quote is not found in the turn it names",
  schema: "the reply did not match the claims schema",
};

// The first messages of the receipts call: the receipts prompt as the system message and the speech with its citable turns as one user message.
export function buildReceiptsMessages(promptText: string, input: ReceiptsInput): ChatMessage[] {
  const content = [
    '<speech side="' + input.side + '">\n' + input.speechText + "\n</speech>",
    "<card_quotes>\n" + quoteLines(input.cardQuotes) + "\n</card_quotes>",
    "<recall_turns>\n" + recallLines(input.recallTurns) + "\n</recall_turns>",
    "List the claims of this speech that rest on your human's own words, as JSON.",
  ].join("\n\n");
  return [
    { role: "system", content: promptText },
    { role: "user", content },
  ];
}

// Reads "12", "t:12" or "[t:12]" as turn index 12; anything else is null.
export function parseTurnLabel(label: string): number | null {
  let text = label.trim();
  if (text.startsWith("[")) text = text.slice(1);
  if (text.endsWith("]")) text = text.slice(0, -1);
  if (text.startsWith("t:")) text = text.slice(2);
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

// Checks each claim inside the one turn its label names, among the speaking side's citable turns only.
export function checkClaims(output: unknown, turns: ReadonlyMap<number, CitableTurn>, forbidden: readonly string[]): CheckedClaim[] | null {
  const parsed = ReceiptsOutput.safeParse(output);
  if (!parsed.success) return null;
  return parsed.data.claims.map((claim) => checkOneClaim(claim, turns, forbidden));
}

// The user message of the one regeneration, naming each failed claim and why.
export function regenerationMessage(failed: ReadonlyArray<FailedClaim>): string {
  const lines = failed.map((item) => "- claim " + String(item.index + 1) + ": " + FAILURE_WORDS[item.failure]);
  return "These claims failed the quote check:\n" + lines.join("\n") + "\nReturn the whole claims list again as JSON. Copy each quote exactly from the turn you name, or leave that claim out.";
}

// Runs the receipts call, regenerates it once when any claim failed, and returns the claims to store plus the count of claims dropped.
export async function runReceipts(args: { messages: ChatMessage[]; call: ReceiptsCallFn; turns: ReadonlyMap<number, CitableTurn>; forbidden: readonly string[] }): Promise<ReceiptsRun> {
  const first = await args.call(args.messages);
  const checked = checkClaims(first, args.turns, args.forbidden);
  if (checked !== null && checked.every((claim) => claim.failure === null)) {
    return { ...storeChosen(checked, false), callCount: 1 };
  }
  const second = await regenerate(args, first, checked);
  if (second === undefined) return fallbackRun(checked);
  if (second === null) return { claims: [], droppedCount: 0, callCount: 2 };
  return { ...storeChosen(second, true), callCount: 2 };
}

// Checks one claim against the turn its label names: an unknown label, or the quote check inside that one turn.
function checkOneClaim(claim: ReceiptsOutput["claims"][number], turns: ReadonlyMap<number, CitableTurn>, forbidden: readonly string[]): CheckedClaim {
  const index = parseTurnLabel(claim.turn_id);
  const turn = index === null ? undefined : turns.get(index);
  const kept = { text: claim.text, quote: claim.quote, lang: claim.lang, gloss: claim.gloss, label: claim.turn_id };
  if (turn === undefined) return { ...kept, turnId: null, failure: "unknown_turn" };
  const result = verifyQuote({ quote: claim.quote, turnText: turn.text, turnNormText: turn.normText, forbidden });
  return { ...kept, turnId: turn.turnId, failure: result.ok ? null : result.reason };
}

// The regeneration call: the first messages, the first reply and the list of failures. Undefined when the call threw; null when its reply broke the schema.
async function regenerate(args: { messages: ChatMessage[]; call: ReceiptsCallFn; turns: ReadonlyMap<number, CitableTurn>; forbidden: readonly string[] }, first: unknown, checked: CheckedClaim[] | null): Promise<CheckedClaim[] | null | undefined> {
  const retry: ChatMessage[] = [
    ...args.messages,
    { role: "assistant", content: JSON.stringify(first) },
    { role: "user", content: regenerationMessage(failuresOf(checked)) },
  ];
  try {
    return checkClaims(await args.call(retry), args.turns, args.forbidden);
  } catch {
    return undefined;
  }
}

// The run when the second call threw: the first reply's claims, or none when that reply broke the schema.
function fallbackRun(checked: CheckedClaim[] | null): ReceiptsRun {
  if (checked === null) return { claims: [], droppedCount: 0, callCount: 2 };
  return { ...storeChosen(checked, false), callCount: 2 };
}

// The failed claims by index, or the one schema line when the reply did not parse.
function failuresOf(checked: CheckedClaim[] | null): FailedClaim[] {
  if (checked === null) return [{ index: 0, failure: "schema" }];
  return checked.flatMap((claim, index) => (claim.failure === null ? [] : [{ index, failure: claim.failure }]));
}

// The claims to store from one checked reply: a claim without a turn is dropped and counted; the rest are stored with their checks.
function storeChosen(checked: CheckedClaim[], isRegenerated: boolean): { claims: StoredClaim[]; droppedCount: number } {
  const claims: StoredClaim[] = [];
  let droppedCount = 0;
  for (const claim of checked) {
    if (claim.turnId === null) {
      droppedCount += 1;
      continue;
    }
    claims.push({ text: claim.text, quote: claim.quote, lang: claim.lang, gloss: claim.gloss, turnId: claim.turnId, isVerified: claim.failure === null, isRegenerated });
  }
  return { claims, droppedCount };
}

// The quote lines of the receipts input, or the word none when there are no card quotes.
function quoteLines(quotes: ReceiptsInput["cardQuotes"]): string {
  if (quotes.length === 0) return "(none)";
  return quotes.map((quote) => "[" + turnLabel(quote.turnIndex) + '] "' + quote.quote + '" (item: ' + quote.claim + ")").join("\n");
}

// The recall lines of the receipts input, or the word none when there are no recall turns.
function recallLines(turns: ReceiptsInput["recallTurns"]): string {
  if (turns.length === 0) return "(none)";
  return turns.map((turn) => "[" + turnLabel(turn.turnIndex) + "] " + turn.text).join("\n");
}
