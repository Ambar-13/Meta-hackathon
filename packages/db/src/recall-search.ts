import { sql, type Transaction } from "kysely";
import { RECALL_SNIPPET_CHARS } from "@meet-first/contracts";
import type { Database } from "./types.js";

// Most words of one query that reach the search; later words are dropped [confirm].
export const RECALL_QUERY_WORDS_MAX = 20;

// Smallest trigram word similarity the fallback accepts, from 0 to 1 [confirm].
export const RECALL_TRIGRAM_MIN = 0.3;

// Splits a query into lower-case words of letters, marks and digits, for both search steps.
export function queryWords(query: string): string[] {
  return query.normalize("NFC").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((word) => word.length > 0 && word !== "or").slice(0, RECALL_QUERY_WORDS_MAX);
}

// Cuts a turn to the snippet length without leaving half of a surrogate pair at the end (D38).
function snippetOf(text: string): string {
  const cut = text.slice(0, RECALL_SNIPPET_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  if (cut.length === RECALL_SNIPPET_CHARS && last >= 0xd800 && last <= 0xdbff) return cut.slice(0, -1);
  return cut;
}

// The full-text step: a turn matches when it shares a word with the query, and more shared words rank first (D38).
async function fullTextRows(trx: Transaction<Database>, search: { cardId: string; words: string[]; limit: number }): Promise<Array<{ turn_id: string; text: string }>> {
  const { cardId, limit } = search;
  const query = search.words.join(" or ");
  const result = await sql<{ turn_id: string; text: string }>`SELECT turn_id, text FROM recall_corpus WHERE card_id = ${cardId} AND to_tsvector('simple', norm_text) @@ websearch_to_tsquery('simple', ${query}) ORDER BY ts_rank(to_tsvector('simple', norm_text), websearch_to_tsquery('simple', ${query})) DESC, turn_id LIMIT ${limit}`.execute(trx);
  return result.rows;
}

// The trigram step: turns close to the query, most similar first, none under the floor (D38).
async function trigramRows(trx: Transaction<Database>, search: { cardId: string; words: string[]; limit: number }): Promise<Array<{ turn_id: string; text: string }>> {
  const { cardId, limit } = search;
  const query = search.words.join(" ");
  const result = await sql<{ turn_id: string; text: string }>`SELECT turn_id, text FROM recall_corpus WHERE card_id = ${cardId} AND word_similarity(${query}, norm_text) >= ${RECALL_TRIGRAM_MIN} ORDER BY word_similarity(${query}, norm_text) DESC, turn_id LIMIT ${limit}`.execute(trx);
  return result.rows;
}

// Finds up to five turns of one card's recall corpus: full text first, trigram second (D38, R7.1, invariant 16).
export async function searchRecallCorpus(trx: Transaction<Database>, args: { cardId: string; query: string; limit: 5 }): Promise<Array<{ turnId: string; text: string }>> {
  const words = queryWords(args.query);
  if (words.length === 0) return [];
  const full = await fullTextRows(trx, { cardId: args.cardId, words, limit: args.limit });
  const rows = full.length > 0 ? full : await trigramRows(trx, { cardId: args.cardId, words, limit: args.limit });
  return rows.map((row) => ({ turnId: row.turn_id, text: snippetOf(row.text) }));
}
