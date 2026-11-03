import { sql } from "kysely";
import type { SummaryFound } from "@meet-first/contracts";
import type { DatabaseTransaction } from "@meet-first/db";
import { normQuote, verifyQuote } from "@meet-first/receipts";

// One stored message a quote may be in.
type TurnRow = { id: string; turn_index: number; text: string; norm_text: string };

// The first message of the person's names-checked uploads, newest upload first, whose folded text holds the folded quote; undefined
// when none does. Only frozen uploads count, so a found quote never carries a name the names check has not replaced.
async function turnHolding(trx: DatabaseTransaction, personId: string, folded: string): Promise<TurnRow | undefined> {
  const result = await sql<TurnRow>`
    SELECT t.id, t.turn_index, t.text, t.norm_text FROM turns t JOIN sources s ON s.id = t.source_id
    WHERE t.person_id = ${personId} AND s.frozen_at IS NOT NULL AND strpos(t.norm_text, ${folded}) > 0
    ORDER BY s.created_at DESC, t.turn_index LIMIT 1`.execute(trx);
  return result.rows[0];
}

// Where each quote stands in the person's own messages, in the order given: the quote as the message has it, with the message's
// index and id; null for a quote too short to prove anything or found in no message.
export async function findQuoteTurns(trx: DatabaseTransaction, personId: string, quotes: readonly string[]): Promise<Array<SummaryFound | null>> {
  const found: Array<SummaryFound | null> = [];
  for (const quote of quotes) {
    const folded = normQuote(quote);
    const turn = folded === "" ? undefined : await turnHolding(trx, personId, folded);
    const check = turn === undefined ? null : verifyQuote({ quote, turnText: turn.text, turnNormText: turn.norm_text, forbidden: [] });
    found.push(turn !== undefined && check?.ok === true ? { quote: turn.text.slice(check.originalStart, check.originalEnd), turnIndex: turn.turn_index, turnId: turn.id } : null);
  }
  return found;
}
