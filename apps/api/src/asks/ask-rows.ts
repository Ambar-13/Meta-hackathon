// What exists: the run_ask job writes one persona_answers row for each persona it asks, with that answer's claims as jsonb.
// The problem: the asker reads these rows as results, and the person a persona speaks for reads them as copies; neither may see
// a number about a person or an id of the other person. The step: every row becomes a contracts view here, in one place, so the
// read routes and the meeting route apply the same rules. What this file does not do: read or write the database.
import { z } from "zod";
import { AnswerClaim, ContractError, HELP_MEETABLE_TOP, HTTP, type AboutMeAnswer, type AskAnswer, type AskMode, type AskState, type AskSummary } from "@meet-first/contracts";

// The stored claims of one answer. Each is {text, quote, turnId, verified, supported}; parsing with AnswerClaim keeps the four
// fields the views carry and drops turnId, because a turn id belongs to the other person's notes.
const StoredClaims = z.array(AnswerClaim);

// The columns of one persona_answers row that the ask view reads.
export type AnswerRow = {
  id: string; state: "pending" | "answered" | "failed"; subject_display_name: string; subject_line: string | null; answer: string | null;
  has_sign: boolean | null; claims: unknown; position: number | null; listing_id: string | null; shortlist_rank: number;
};
// The columns of one persona_answers row that a subject's copy reads.
export type CopyRow = { id: string; mode: AskMode; ask_text: string; asker_display_name: string; answer: string | null; claims: unknown; created_at: Date };
// The columns of one persona_asks row that the asker's list reads.
export type AskRow = { id: string; mode: AskMode; text: string; state: AskState; created_at: Date };
// The parts of an answer that decide its place in the view.
type PlacedRow = Pick<AnswerRow, "id" | "position" | "shortlist_rank">;

// The claims of one stored answer as the views show them. Claims that no longer parse are answer_row_invalid (500), so a broken
// row fails on the server, where it is logged, and is never shown half read.
export function parseStoredClaims(claims: unknown): AnswerClaim[] {
  const parsed = StoredClaims.safeParse(claims);
  if (!parsed.success) throw new ContractError("answer_row_invalid", "One answer of this ask could not be read. Try again in a minute.", HTTP.internal);
  return parsed.data;
}

// True when the asker may start a full meeting from this answer: the ask is a help search in state done, and the answer is answered,
// placed 1 to HELP_MEETABLE_TOP (3), and its listing still exists. The read route and the meeting route both use it.
export function isMeetableAnswer(ask: { mode: AskMode; state: AskState }, answer: { state: AnswerRow["state"]; position: number | null; listing_id: string | null }): boolean {
  if (ask.mode !== "help" || ask.state !== "done" || answer.state !== "answered") return false;
  return answer.position !== null && answer.position <= HELP_MEETABLE_TOP && answer.listing_id !== null;
}

// Compares two answers for the view. In words: placed answers first by position, an answer with no position after every placed one,
// then the smaller shortlist rank, then the id, so two reads of the same rows always give the same order.
function compareAnswers(first: PlacedRow, second: PlacedRow): number {
  const firstPlace = first.position ?? Number.MAX_SAFE_INTEGER;
  const secondPlace = second.position ?? Number.MAX_SAFE_INTEGER;
  if (firstPlace !== secondPlace) return firstPlace - secondPlace;
  if (first.shortlist_rank !== second.shortlist_rank) return first.shortlist_rank - second.shortlist_rank;
  return first.id.localeCompare(second.id);
}

// The answers in the order the view shows them; the list passed in is not changed.
export function sortAnswersForView<T extends Pick<AnswerRow, "id" | "position" | "shortlist_rank">>(rows: readonly T[]): T[] {
  return [...rows].sort(compareAnswers);
}

// One answered row as the asker sees it. It never carries the subject's person id, card id or listing id, the support count or the
// shortlist rank.
export function toAskAnswer(ask: { mode: AskMode; state: AskState }, row: AnswerRow): AskAnswer {
  return {
    answerId: row.id,
    displayName: row.subject_display_name,
    line: row.subject_line,
    answer: row.answer ?? "",
    claims: parseStoredClaims(row.claims),
    hasSign: row.has_sign ?? false,
    position: row.position,
    canMeet: isMeetableAnswer(ask, row),
  };
}

// One answer the caller's persona gave, as the caller's copy: what was asked, the asker's display name, and the answer with its
// claims. It never carries the asker's person id.
export function toAboutMeAnswer(row: CopyRow): AboutMeAnswer {
  return { answerId: row.id, mode: row.mode, text: row.ask_text, askerName: row.asker_display_name, answer: row.answer ?? "", claims: parseStoredClaims(row.claims), createdAt: row.created_at.toISOString() };
}

// One of the caller's own asks as their list shows it.
export function toAskSummary(row: AskRow): AskSummary {
  return { askId: row.id, mode: row.mode, text: row.text, state: row.state, createdAt: row.created_at.toISOString() };
}
