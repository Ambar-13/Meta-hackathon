import { sql, type Transaction } from "kysely";
import { RECALL_SNIPPET_CHARS } from "@meet-first/contracts";
import type { Database } from "./types.js";

// Most words of one query that reach the search; later words are dropped.
export const RECALL_QUERY_WORDS_MAX = 20;

// Most turns a recall corpus may hold for an ask to read all of it instead of searching it.
export const RECALL_WHOLE_MAX = 40;

// How many turns of a larger corpus an ask reads besides the search's hits, one from each stretch.
export const RECALL_SPREAD_SIZE = 30;

// Smallest trigram word similarity the fallback accepts, from 0 to 1.
export const RECALL_TRIGRAM_MIN = 0.3;

// Splits a query into lower-case words of letters, marks and digits, for both search steps.
export function queryWords(query: string): string[] {
  return query
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word.length > 0 && word !== "or")
    .slice(0, RECALL_QUERY_WORDS_MAX);
}

// Cuts a turn to the snippet length without leaving half of a surrogate pair at the end.
function snippetOf(text: string): string {
  const cut = text.slice(0, RECALL_SNIPPET_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  if (cut.length === RECALL_SNIPPET_CHARS && last >= 0xd800 && last <= 0xdbff)
    return cut.slice(0, -1);
  return cut;
}

// The full-text step: a turn matches when it shares a word with the query, and more shared words
// rank first. Equal ranks keep the turns' order in the person's file. A turn's id is random, so
// ordering by it gave another list on each rebuild.
async function fullTextRows(
  trx: Transaction<Database>,
  search: { cardId: string; words: string[]; limit: number },
): Promise<Array<{ turn_id: string; text: string }>> {
  const { cardId, limit } = search;
  const query = search.words.join(" or ");
  const result = await sql<{
    turn_id: string;
    text: string;
  }>`SELECT r.turn_id, r.text FROM recall_corpus r JOIN turns t ON t.id = r.turn_id WHERE r.card_id = ${cardId} AND to_tsvector('simple', r.norm_text) @@ websearch_to_tsquery('simple', ${query}) ORDER BY ts_rank(to_tsvector('simple', r.norm_text), websearch_to_tsquery('simple', ${query})) DESC, t.turn_index LIMIT ${limit}`.execute(
    trx,
  );
  return result.rows;
}

// The trigram step: turns close to the query, most similar first, none under the floor, equal
// scores in file order.
async function trigramRows(
  trx: Transaction<Database>,
  search: { cardId: string; words: string[]; limit: number },
): Promise<Array<{ turn_id: string; text: string }>> {
  const { cardId, limit } = search;
  const query = search.words.join(" ");
  const result = await sql<{
    turn_id: string;
    text: string;
  }>`SELECT r.turn_id, r.text FROM recall_corpus r JOIN turns t ON t.id = r.turn_id WHERE r.card_id = ${cardId} AND word_similarity(${query}, r.norm_text) >= ${RECALL_TRIGRAM_MIN} ORDER BY word_similarity(${query}, r.norm_text) DESC, t.turn_index LIMIT ${limit}`.execute(
    trx,
  );
  return result.rows;
}

// All of one card's recall corpus in file order, or null when it holds more than RECALL_WHOLE_MAX
// turns. A search only finds words the question shares, so an ask reads a small corpus whole: "a
// pitch for a cafe" shares no word with "I don't need a big market slide", which is the message
// that answers it.
export async function wholeRecallCorpus(
  trx: Transaction<Database>,
  cardId: string,
): Promise<Array<{ turnId: string; text: string }> | null> {
  const result = await sql<{
    turn_id: string;
    text: string;
  }>`SELECT r.turn_id, r.text FROM recall_corpus r JOIN turns t ON t.id = r.turn_id WHERE r.card_id = ${cardId} ORDER BY t.turn_index LIMIT ${RECALL_WHOLE_MAX + 1}`.execute(
    trx,
  );
  if (result.rows.length > RECALL_WHOLE_MAX) return null;
  return result.rows.map((row) => ({ turnId: row.turn_id, text: snippetOf(row.text) }));
}

// A spread of one card's recall corpus for an ask about something no message mentions: the file cut
// into RECALL_SPREAD_SIZE stretches, and the longest turn of each, because a longer message shows
// more of how someone thinks. In file order, and it can hold turns the search also found.
export async function spreadRecallCorpus(
  trx: Transaction<Database>,
  cardId: string,
): Promise<Array<{ turnId: string; text: string }>> {
  const result = await sql<{
    turn_id: string;
    text: string;
  }>`WITH stretches AS (SELECT r.turn_id, r.text, t.turn_index, ntile(${RECALL_SPREAD_SIZE}::int) OVER (ORDER BY t.turn_index) AS stretch FROM recall_corpus r JOIN turns t ON t.id = r.turn_id WHERE r.card_id = ${cardId}) SELECT DISTINCT ON (stretch) turn_id, text FROM stretches ORDER BY stretch, length(text) DESC, turn_index`.execute(
    trx,
  );
  return result.rows.map((row) => ({ turnId: row.turn_id, text: snippetOf(row.text) }));
}

// Finds up to five turns of one card's recall corpus: full text first, trigram second.
export async function searchRecallCorpus(
  trx: Transaction<Database>,
  args: { cardId: string; query: string; limit: 5 },
): Promise<Array<{ turnId: string; text: string }>> {
  const words = queryWords(args.query);
  if (words.length === 0) return [];
  const full = await fullTextRows(trx, { cardId: args.cardId, words, limit: args.limit });
  const rows =
    full.length > 0
      ? full
      : await trigramRows(trx, { cardId: args.cardId, words, limit: args.limit });
  return rows.map((row) => ({ turnId: row.turn_id, text: snippetOf(row.text) }));
}
