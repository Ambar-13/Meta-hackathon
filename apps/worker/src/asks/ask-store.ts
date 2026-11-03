// Every read and write of the persona_asks and persona_answers rows the run_ask job makes. Each takes the transaction its caller opened in
// the asker's own context, because only the asker's policies let the job write these rows (migration 0006); subjects are read elsewhere.
import { ContractError, Uuid, type AskMode, type AskState, type QuestionKind } from "@meet-first/contracts";
import { numberFromPostgres, type DatabaseTransaction } from "@meet-first/db";
import { z } from "zod";
import type { StoredAnswerClaim } from "./ask-requests.js";

// One ask as the job reads it from persona_asks; questionKind is the kind the check gave, null until checked.
export type AskRow = { id: string; personId: string; mode: AskMode; pairId: string | null; text: string; state: AskState; aboutName: string | null; questionKind: QuestionKind | null };
// One answer row as the job reads it from persona_answers, with its claims checked against the stored shape.
export type AnswerRow = {
  id: string; subjectPersonId: string; subjectCardId: string; listingId: string | null; askerDisplayName: string; subjectDisplayName: string;
  shortlistRank: number; state: "pending" | "answered" | "failed"; hasSign: boolean | null; claims: StoredAnswerClaim[];
};
// One answer row to insert: who answers, from which card and listing, with the name and line copied at this moment.
export type NewAnswer = { subjectPersonId: string; subjectCardId: string; listingId: string | null; subjectDisplayName: string; subjectLine: string | null; shortlistRank: number };
// One state change of an ask. It happens only from the state the job read; a finished state stamps finished_at.
export type AskMove = { askId: string; from: AskState; to: AskState; now: Date; refusedReason?: string; questionKind?: QuestionKind };
// What one answered row stores.
export type AnswerWrite = { answerId: string; answer: string; hasSign: boolean; claims: readonly StoredAnswerClaim[]; now: Date };
// One answer's supported count and place.
export type Placement = { answerId: string; supportedCount: number; position: number | null };

// The stored claims shape of migration 0006's column comment, checked on every read.
const StoredClaimList = z.array(z.object({ text: z.string(), quote: z.string(), turnId: Uuid.nullable(), verified: z.boolean(), supported: z.boolean().nullable() }));

// Reads one ask; null when it is missing, which is also what row security shows for another person's ask.
export async function readAsk(trx: DatabaseTransaction, askId: string): Promise<AskRow | null> {
  const row = await trx.selectFrom("persona_asks").select(["id", "person_id", "mode", "pair_id", "text", "state", "about_name", "question_kind"])
    .where("id", "=", askId).executeTakeFirst();
  if (row === undefined) return null;
  return { id: row.id, personId: row.person_id, mode: row.mode, pairId: row.pair_id, text: row.text, state: row.state, aboutName: row.about_name, questionKind: row.question_kind };
}

// Moves an ask from the state the job read to the next one and says whether it moved; a run that lost a race moves nothing.
export async function moveAsk(trx: DatabaseTransaction, move: AskMove): Promise<boolean> {
  const isFinished = move.to === "done" || move.to === "refused" || move.to === "failed";
  const result = await trx.updateTable("persona_asks").set({
    state: move.to,
    ...(move.refusedReason === undefined ? {} : { refused_reason: move.refusedReason }),
    ...(move.questionKind === undefined ? {} : { question_kind: move.questionKind }),
    ...(isFinished ? { finished_at: move.now } : {}),
  }).where("id", "=", move.askId).where("state", "=", move.from).executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Locks the ask row until the transaction ends, so two runs write its answer rows or its places one after the other; returns its state.
export async function lockAsk(trx: DatabaseTransaction, askId: string): Promise<AskState | null> {
  const row = await trx.selectFrom("persona_asks").select("state").where("id", "=", askId).forUpdate().executeTakeFirst();
  return row === undefined ? null : row.state;
}

// How many answer rows the ask has, in any state.
export async function countAnswers(trx: DatabaseTransaction, askId: string): Promise<number> {
  const row = await trx.selectFrom("persona_answers").select((eb) => eb.fn.countAll().as("total")).where("ask_id", "=", askId).executeTakeFirstOrThrow();
  return numberFromPostgres(row.total);
}

// One person's display name, read in that person's own context; null when the row is gone or the person is being deleted, so no
// one is asked, and no ask goes on, once a deletion has started.
export async function readDisplayName(trx: DatabaseTransaction, personId: string): Promise<string | null> {
  const row = await trx.selectFrom("people").select("display_name").where("id", "=", personId).where("state", "=", "active").executeTakeFirst();
  return row === undefined ? null : row.display_name;
}

// Inserts the ask's answer rows in one statement, copying the ask's text and the asker's name onto each. A subject who already
// has a row for this ask keeps it, by the unique key on (ask_id, subject_person_id).
export async function insertAnswers(trx: DatabaseTransaction, scope: { ask: AskRow; askerName: string; subjects: readonly NewAnswer[] }): Promise<void> {
  await trx.insertInto("persona_answers").values(scope.subjects.map((subject) => ({
    ask_id: scope.ask.id, asker_person_id: scope.ask.personId, subject_person_id: subject.subjectPersonId, subject_card_id: subject.subjectCardId,
    listing_id: subject.listingId, mode: scope.ask.mode, ask_text: scope.ask.text, asker_display_name: scope.askerName,
    subject_display_name: subject.subjectDisplayName, subject_line: subject.subjectLine, shortlist_rank: subject.shortlistRank,
  }))).onConflict((conflict) => conflict.columns(["ask_id", "subject_person_id"]).doNothing()).execute();
}

// The ask's answer rows in one state, by shortlist rank and then id.
export async function readAnswers(trx: DatabaseTransaction, askId: string, state: AnswerRow["state"]): Promise<AnswerRow[]> {
  const rows = await trx.selectFrom("persona_answers")
    .select(["id", "subject_person_id", "subject_card_id", "listing_id", "asker_display_name", "subject_display_name", "shortlist_rank", "state", "has_sign", "claims"])
    .where("ask_id", "=", askId).where("state", "=", state).orderBy("shortlist_rank").orderBy("id").execute();
  return rows.map((row) => ({
    id: row.id, subjectPersonId: row.subject_person_id, subjectCardId: row.subject_card_id, listingId: row.listing_id, askerDisplayName: row.asker_display_name,
    subjectDisplayName: row.subject_display_name, shortlistRank: row.shortlist_rank, state: row.state, hasSign: row.has_sign, claims: parseClaims(row.claims),
  }));
}

// Marks one pending answer failed; the ask's other answers go on.
export async function markAnswerFailed(trx: DatabaseTransaction, answerId: string): Promise<void> {
  await trx.updateTable("persona_answers").set({ state: "failed" }).where("id", "=", answerId).where("state", "=", "pending").execute();
}

// Stores one persona's checked reply on its row, only while the row is still pending.
export async function storeAnswer(trx: DatabaseTransaction, write: AnswerWrite): Promise<void> {
  await trx.updateTable("persona_answers").set({ state: "answered", answer: write.answer, has_sign: write.hasSign, claims: JSON.stringify(write.claims), answered_at: write.now })
    .where("id", "=", write.answerId).where("state", "=", "pending").execute();
}

// Writes one answer's claims after the support check set their supported values.
export async function writeClaims(trx: DatabaseTransaction, answerId: string, claims: readonly StoredAnswerClaim[]): Promise<void> {
  await trx.updateTable("persona_answers").set({ claims: JSON.stringify(claims) }).where("id", "=", answerId).execute();
}

// Writes one answer's supported count and place.
export async function writePlacement(trx: DatabaseTransaction, placement: Placement): Promise<void> {
  await trx.updateTable("persona_answers").set({ supported_count: placement.supportedCount, position: placement.position }).where("id", "=", placement.answerId).execute();
}

// Checks a claims value read from the database against the stored shape; a broken row stops the job here instead of reaching a screen.
function parseClaims(value: unknown): StoredAnswerClaim[] {
  const parsed = StoredClaimList.safeParse(value);
  if (!parsed.success) throw new ContractError("ask_claims_invalid", "A stored answer's claims do not have the stored shape. Check the last write to persona_answers.claims.", 500);
  return parsed.data;
}
