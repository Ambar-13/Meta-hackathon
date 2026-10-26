// Asks each pending answer's persona once and stores the checked reply (design section 4 step 4). A request holds only what its subject
// allowed: public items for a help search (P1, P7); approved, verified items and, when the friend switched recall on, recall results for
// a friend ask (P3); and the subject's quiz misses as do-not-guess topics (D31).
import type { Kysely } from "kysely";
import { ContractError, PersonaAnswerOutput, RECALL_TOP_K } from "@meet-first/contracts";
import { searchRecallCorpus, withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import { LimiterBusy } from "@meet-first/llm";
import { readPrompt, type Prompt } from "@meet-first/prompts";
import type { JobContext } from "../job-context.js";
import type { CitableTurn } from "../meetings/receipts.js";
import { quizMisses } from "../quizzes/index.js";
import { checkAnswerClaims, personaAnswerCallArgs, personaAnswerMessages, type PersonaItem, type RecallLine } from "./ask-requests.js";
import { markAnswerFailed, readAnswers, readDisplayName, storeAnswer, type AnswerRow, type AskRow } from "./ask-store.js";

// What one persona call ended with: a stored answer, a failed answer, or a full token window that leaves the answer pending.
type AnswerOutcome = "answered" | "failed" | "limited";
// The two prompts every persona_answer request of one run joins, read at call time (seams S7).
type AnswerPrompts = { personaAnswer: Prompt; untrustedRules: Prompt };
// One pending answer to ask, with its ask and the prompts.
type AnswerScope = { ask: AskRow; row: AnswerRow; prompts: AnswerPrompts };
// One item with the whole turn its quote comes from.
type ItemWithTurn = { item: PersonaItem; turn: CitableTurn };
// One recall result with the whole turn it came from.
type RecallWithTurn = { line: RecallLine; turn: CitableTurn };
// What one request is built from, and the turns its claims may cite, by turn index.
type SubjectMaterial = { items: PersonaItem[]; recall: RecallLine[]; misses: string[]; turns: Map<number, CitableTurn> };

// Asks every pending answer's persona at the same time, at most HELP_SHORTLIST_MAX of them, and stores each reply as it arrives.
// "limited" when any call met a full token window; those answers stay pending for the next run (design section 4 step 4, D58).
export async function answerPending(context: JobContext, ask: AskRow): Promise<"settled" | "limited"> {
  const prompts: AnswerPrompts = { personaAnswer: readPrompt("persona-answer"), untrustedRules: readPrompt("untrusted-data-rules") };
  const pending = await withPerson(context.db, ask.personId, (trx) => readAnswers(trx, ask.id, "pending"));
  const outcomes = await Promise.all(pending.map((row) => answerOne(context, { ask, row, prompts })));
  return outcomes.includes("limited") ? "limited" : "settled";
}

// One persona: read its material, call the model, check the reply's quotes, store the answer. A failed call or a reply that breaks
// the schema fails this answer only, and the others go on.
async function answerOne(context: JobContext, scope: AnswerScope): Promise<AnswerOutcome> {
  const { ask, row, prompts } = scope;
  const material = await readSubjectMaterial(context.db, ask, row);
  if (material === null) return failAnswer(context, scope, "persona_subject_gone");
  const messages = personaAnswerMessages({ personaAnswer: prompts.personaAnswer.text, untrustedRules: prompts.untrustedRules.text }, {
    mode: ask.mode, askText: ask.text, subjectName: row.subjectDisplayName, askerName: row.askerDisplayName,
    items: material.items, recall: material.recall, misses: material.misses,
  });
  let reply: unknown;
  try {
    const result = await context.llm.complete(personaAnswerCallArgs({ askerId: ask.personId, promptVersion: prompts.personaAnswer.version, messages }));
    reply = result.parsed;
  } catch (error) {
    if (error instanceof LimiterBusy) return "limited";
    return failAnswer(context, scope, error instanceof ContractError ? error.code : "persona_answer_failed");
  }
  const output = PersonaAnswerOutput.safeParse(reply);
  if (!output.success) return failAnswer(context, scope, "persona_answer_reply_invalid");
  const claims = checkAnswerClaims(output.data.claims, material.turns, [ask.text, prompts.personaAnswer.text, prompts.untrustedRules.text]);
  await withPerson(context.db, ask.personId, (trx) => storeAnswer(trx, { answerId: row.id, answer: output.data.answer, hasSign: output.data.has_sign, claims, now: context.now() }));
  return "answered";
}

// Logs why one answer failed, by code and ids only, and marks it failed in the asker's context.
async function failAnswer(context: JobContext, scope: AnswerScope, code: string): Promise<"failed"> {
  context.log.warn({ code, askId: scope.ask.id, answerId: scope.row.id }, "This persona's answer failed; the ask's other answers go on.");
  await withPerson(context.db, scope.ask.personId, (trx) => markAnswerFailed(trx, scope.row.id));
  return "failed";
}

// Reads one subject's material in the subject's own context, and only reads. Null when a help answer's listing is gone, names another
// card or, for a romance ask, has its dating switch off [confirm]; when the subject's account deletion has started (D69); when the card
// is gone or no longer approved; and, for a friend ask, when the friend has turned friend asks off since the answer row was written
// (P3). A help answer never reads recall (P7).
async function readSubjectMaterial(db: Kysely<Database>, ask: AskRow, row: AnswerRow): Promise<SubjectMaterial | null> {
  return withPerson(db, row.subjectPersonId, async (trx) => {
    if ((await readDisplayName(trx, row.subjectPersonId)) === null) return null;
    if (ask.mode === "help" && !(await isListingCurrent(trx, ask, row))) return null;
    const card = await trx.selectFrom("cards").select(["recall_allowed", "state", "friends_can_ask"]).where("id", "=", row.subjectCardId).executeTakeFirst();
    if (card === undefined || card.state !== "approved" || (ask.mode === "react" && !card.friends_can_ask)) return null;
    const items = await readItems(trx, row.subjectCardId, ask.mode === "help");
    const misses = await quizMisses(trx, row.subjectCardId);
    const recall = ask.mode === "react" && card.recall_allowed ? await readRecall(trx, row.subjectCardId, ask.text) : [];
    return materialOf(items, recall, misses);
  });
}

// Whether a help answer's listing still exists with the same card, and is open to dating questions when the ask is a romance one.
async function isListingCurrent(trx: DatabaseTransaction, ask: AskRow, row: AnswerRow): Promise<boolean> {
  const listingId = row.listingId;
  if (listingId === null) return false;
  const listing = await trx.selectFrom("directory_listings").select(["card_id", "open_to_romance"]).where("id", "=", listingId).executeTakeFirst();
  if (listing === undefined || listing.card_id !== row.subjectCardId) return false;
  return ask.questionKind !== "romance" || listing.open_to_romance;
}

// The card's approved, verified items in position order with the turns they quote; public ones only for a help answer (P1).
async function readItems(trx: DatabaseTransaction, cardId: string, isPublicOnly: boolean): Promise<ItemWithTurn[]> {
  const rows = await trx.selectFrom("card_items as ci").innerJoin("turns as t", "t.id", "ci.turn_id")
    .select(["ci.kind", "ci.claim", "ci.quote", "t.id as turn_id", "t.turn_index", "t.text", "t.norm_text"])
    .where("ci.card_id", "=", cardId).where("ci.approved", "=", true).where("ci.verified", "=", true)
    .$if(isPublicOnly, (query) => query.where("ci.is_public", "=", true))
    .orderBy("ci.position").execute();
  return rows.map((row) => ({
    item: { turnIndex: row.turn_index, kind: row.kind, claim: row.claim, quote: row.quote },
    turn: { turnId: row.turn_id, turnIndex: row.turn_index, text: row.text, normText: row.norm_text },
  }));
}

// A friend's recall results for the ask's text, each turn once, in the search's order (D38): the snippet the request shows, and the
// whole turn the quote check reads.
async function readRecall(trx: DatabaseTransaction, cardId: string, askText: string): Promise<RecallWithTurn[]> {
  const hits = await searchRecallCorpus(trx, { cardId, query: askText, limit: RECALL_TOP_K });
  if (hits.length === 0) return [];
  const turns = await trx.selectFrom("turns").select(["id", "turn_index", "text", "norm_text"]).where("id", "in", hits.map((hit) => hit.turnId)).execute();
  const results: RecallWithTurn[] = [];
  for (const hit of hits) {
    const turn = turns.find((candidate) => candidate.id === hit.turnId);
    if (turn === undefined || results.some((result) => result.line.turnIndex === turn.turn_index)) continue;
    results.push({ line: { turnIndex: turn.turn_index, text: hit.text }, turn: { turnId: turn.id, turnIndex: turn.turn_index, text: turn.text, normText: turn.norm_text } });
  }
  return results;
}

// The request's material and the turns its claims may cite: every item's turn, then every recall turn not already there.
function materialOf(items: readonly ItemWithTurn[], recall: readonly RecallWithTurn[], misses: string[]): SubjectMaterial {
  const turns = new Map<number, CitableTurn>();
  for (const entry of items) turns.set(entry.item.turnIndex, entry.turn);
  for (const entry of recall) if (!turns.has(entry.line.turnIndex)) turns.set(entry.line.turnIndex, entry.turn);
  return { items: items.map((entry) => entry.item), recall: recall.map((entry) => entry.line), misses, turns };
}
