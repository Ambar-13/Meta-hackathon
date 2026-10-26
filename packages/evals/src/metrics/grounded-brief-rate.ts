// Grounded brief rate: the share of brief lines whose every quote passes the quote check again inside the right side's turn (R3.2).
// The stored verified flag is read, but the quote is checked again with verifyQuote, so an altered quote fails.
import { verifyQuote } from "@meet-first/receipts";
import type { Quote } from "@meet-first/contracts";
import type { BriefLineRow, EvalRows, TurnTextRow } from "../collect-rows.js";
import type { MetricResult } from "./index.js";

// Whether one quote holds: verified, found in the named turn, and that turn belongs to the person on the quote's side.
function quoteHolds(quote: Quote, context: { sides: Record<"a" | "b", string> | undefined; question: string; turns: Map<string, TurnTextRow> }): boolean {
  if (!quote.verified || context.sides === undefined) return false;
  const turn = context.turns.get(quote.turnId);
  if (turn === undefined || turn.personId !== context.sides[quote.side]) return false;
  return verifyQuote({ quote: quote.text, turnText: turn.text, turnNormText: turn.normText, forbidden: [context.question] }).ok;
}

// Whether one brief line is grounded: it has at least one quote and every quote holds.
function isGrounded(line: BriefLineRow, rows: EvalRows): boolean {
  const quotes = line.point.quotes;
  const sides = rows.personBySide.get(line.meetingId);
  const question = rows.questionByMeeting.get(line.meetingId) ?? "";
  return quotes.length >= 1 && quotes.every((quote) => quoteHolds(quote, { sides, question, turns: rows.turns }));
}

// Reads the brief lines of the driven meetings and returns the grounded share, or no value when there are no lines.
export function measureGroundedBriefRate(rows: EvalRows): MetricResult {
  const total = rows.briefLines.length;
  const grounded = rows.briefLines.filter((line) => isGrounded(line, rows)).length;
  const value = total === 0 ? null : grounded / total;
  return {
    key: "grounded_brief_rate",
    label: "grounded brief rate",
    value,
    display: value === null ? "no data" : value.toFixed(3),
    n: total,
    target: null,
    direction: null,
    rows: ["R3.2"],
    detail: { grounded },
  };
}
