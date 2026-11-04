import { sql } from "kysely";
import type { SummaryFound } from "@meet-first/contracts";
import type { DatabaseTransaction } from "@meet-first/db";
import { normQuote, verifyQuote } from "@meet-first/receipts";
import { PROTECTED_TOKEN } from "../cards/index.js";

// One stored message a quote may be in.
type TurnRow = { id: string; turn_index: number; text: string; norm_text: string };
// How many messages holding a quote's longest piece are tried for the rest of its pieces.
const PIECE_CANDIDATES_MAX = 20;
// The most characters a message's own role token or placeholder may take between two pieces of a quote.
const TOKEN_GAP_MAX = 100;

// The messages of the person's names-checked uploads, newest upload first, whose folded text holds the folded text; at most limit.
// Only frozen uploads count, so a found quote never carries a name the names check has not replaced.
async function turnsHolding(
  trx: DatabaseTransaction,
  personId: string,
  search: { folded: string; limit: number },
): Promise<TurnRow[]> {
  const result = await sql<TurnRow>`
    SELECT t.id, t.turn_index, t.text, t.norm_text FROM turns t JOIN sources s ON s.id = t.source_id
    WHERE t.person_id = ${personId} AND s.frozen_at IS NOT NULL AND strpos(t.norm_text, ${search.folded}) > 0
    ORDER BY s.created_at DESC, t.turn_index LIMIT ${search.limit}`.execute(trx);
  return result.rows;
}

// The pieces of a quote around its role tokens and placeholders, each folded. A name in the summary and the same name in a message
// are replaced by tokens that need not match, so only the pieces between them are compared.
function quotePieces(quote: string): string[] {
  return quote
    .split(PROTECTED_TOKEN)
    .map((piece) => normQuote(piece))
    .filter((piece) => piece !== "");
}

// Where the pieces sit in one folded message, in order, each within TOKEN_GAP_MAX characters of the one before; null when they do not.
function piecesSpan(
  normText: string,
  pieces: readonly string[],
): { start: number; end: number } | null {
  const [first, ...rest] = pieces;
  if (first === undefined) return null;
  for (
    let start = normText.indexOf(first);
    start !== -1;
    start = normText.indexOf(first, start + 1)
  ) {
    let end = start + first.length;
    const isWhole = rest.every((piece) => {
      const at = normText.indexOf(piece, end);
      if (at === -1 || at - end > TOKEN_GAP_MAX) return false;
      end = at + piece.length;
      return true;
    });
    if (isWhole) return { start, end };
  }
  return null;
}

// The found record of one message for this folded text, as the message has it; null when the text is too short or not in it.
function foundIn(turn: TurnRow, folded: string): SummaryFound | null {
  const check = verifyQuote({
    quote: folded,
    turnText: turn.text,
    turnNormText: turn.norm_text,
    forbidden: [],
  });
  return check.ok
    ? {
        quote: turn.text.slice(check.originalStart, check.originalEnd),
        turnIndex: turn.turn_index,
        turnId: turn.id,
      }
    : null;
}

// Where one quote stands in the person's own messages: the message's own words for it, with the message's index and id; null for a
// quote too short to prove anything or found in no message. A quote with role tokens or placeholders is found piece by piece.
async function findQuote(
  trx: DatabaseTransaction,
  personId: string,
  quote: string,
): Promise<SummaryFound | null> {
  const pieces = quotePieces(quote);
  if (pieces.length <= 1) {
    const folded = normQuote(quote);
    const [turn] = folded === "" ? [] : await turnsHolding(trx, personId, { folded, limit: 1 });
    return turn === undefined ? null : foundIn(turn, folded);
  }
  const longest = pieces.reduce((best, piece) => (piece.length > best.length ? piece : best));
  for (const turn of await turnsHolding(trx, personId, {
    folded: longest,
    limit: PIECE_CANDIDATES_MAX,
  })) {
    const span = piecesSpan(turn.norm_text, pieces);
    const found = span === null ? null : foundIn(turn, turn.norm_text.slice(span.start, span.end));
    if (found !== null) return found;
  }
  return null;
}

// Where each quote stands in the person's own messages, in the order given.
export async function findQuoteTurns(
  trx: DatabaseTransaction,
  personId: string,
  quotes: readonly string[],
): Promise<Array<SummaryFound | null>> {
  const found: Array<SummaryFound | null> = [];
  for (const quote of quotes) found.push(await findQuote(trx, personId, quote));
  return found;
}
