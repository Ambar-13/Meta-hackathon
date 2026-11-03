import type { Transaction } from "kysely";
import type { z } from "zod";
import { recallResult, RECALL_SNIPPET_CHARS, RECALL_TOP_K } from "@meet-first/contracts";
import { searchRecallCorpus, type Database } from "@meet-first/db";
import { turnLabel } from "./prompt-builder.js";
import type { CitableTurn } from "./receipts.js";

// One recall as the round records it: the event result, the model's tool message text, and each turn twice: the snippet the model saw and the whole turn the receipts check reads.
export type RecallRun = { result: z.infer<typeof recallResult>; messageText: string; turns: Array<CitableTurn & { snippet: string }> };

// Runs one recall inside the round's transaction, over the speaking side's card only; an empty corpus gives no turns.
export async function runRecall(trx: Transaction<Database>, args: { cardId: string; query: string }): Promise<RecallRun> {
  const rows = await searchRecallCorpus(trx, { cardId: args.cardId, query: args.query, limit: RECALL_TOP_K });
  if (rows.length === 0) return { result: { turns: [] }, messageText: formatRecallMessage([]), turns: [] };
  const turnRows = await trx.selectFrom("turns").select(["id", "turn_index", "text", "norm_text"]).where("id", "in", rows.map((row) => row.turnId)).execute();
  const turns: Array<CitableTurn & { snippet: string }> = [];
  for (const row of rows) {
    const turn = turnRows.find((candidate) => candidate.id === row.turnId);
    if (turn === undefined) continue;
    turns.push({ turnId: row.turnId, turnIndex: turn.turn_index, text: turn.text, normText: turn.norm_text, snippet: truncateUtf16(row.text, RECALL_SNIPPET_CHARS) });
  }
  const result = recallResult.parse({ turns: turns.map((turn) => ({ turnId: turn.turnId, text: turn.snippet })) });
  const messageText = formatRecallMessage(turns.map((turn) => ({ turnIndex: turn.turnIndex, text: turn.snippet })));
  return { result, messageText, turns };
}

// The recall a listed persona met through the directory gets: no turns, because strangers see only its owner's public items.
export function noRecall(): RecallRun {
  return { result: { turns: [] }, messageText: formatRecallMessage([]), turns: [] };
}

// The tool message the model reads: the turns as labelled lines inside recall_result tags, declared data.
export function formatRecallMessage(turns: ReadonlyArray<{ turnIndex: number; text: string }>): string {
  const body = turns.length === 0 ? "no matching turns" : turns.map((turn) => "[" + turnLabel(turn.turnIndex) + "] " + turn.text).join("\n");
  return "<recall_result>\n" + body + "\n</recall_result>";
}

// Cuts text to at most maxUnits UTF-16 code units without splitting a surrogate pair (600 characters each).
export function truncateUtf16(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  const cut = text.slice(0, maxUnits);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
