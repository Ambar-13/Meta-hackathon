// Asks each pending answer's persona once and stores the checked reply. A request holds only what its subject
// allowed: public items for a help search; approved, verified items and, when the subject switched recall on, recall results for
// a friend or self ask, searched with the words the search-words call gives; the summary's points for a self ask, and for a friend ask
// when the subject's summary switch is on; and the subject's quiz misses as do-not-guess topics.
import type { Kysely } from "kysely";
import { ContractError, PersonaAnswerOutput, RECALL_TOP_K } from "@meet-first/contracts";
import { searchRecallCorpus, withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import { LimiterBusy } from "@meet-first/llm";
import { summaryPriority } from "@meet-first/parsers";
import { readPrompt, type Prompt } from "@meet-first/prompts";
import type { JobContext } from "../job-context.js";
import type { CitableTurn } from "../meetings/receipts.js";
import { quizMisses } from "../quizzes/index.js";
import { checkAnswerClaims, personaAnswerCallArgs, personaAnswerMessages, type PersonaItem, type RecallLine } from "./ask-requests.js";
import { markAnswerFailed, readAnswers, readDisplayName, storeAnswer, type AnswerRow, type AskRow } from "./ask-store.js";
import { searchQueryOf, searchWordsCall } from "./search-words.js";
import { readSummaryMaterial, readUsablePoints, type SummaryMaterial } from "./summary-material.js";

// What one persona call ended with: a stored answer, a failed answer, or a full token window that leaves the answer pending.
type AnswerOutcome = "answered" | "failed" | "limited";
// The two prompts every persona_answer request of one run joins, read at call time.
type AnswerPrompts = { personaAnswer: Prompt; untrustedRules: Prompt };
// One pending answer to ask, with its ask and the prompts.
type AnswerScope = { ask: AskRow; row: AnswerRow; prompts: AnswerPrompts };
// One item with the whole turn its quote comes from.
type ItemWithTurn = { item: PersonaItem; turn: CitableTurn; sourceId: string };
// One recall result with the whole turn it came from.
type RecallWithTurn = { line: RecallLine; turn: CitableTurn; sourceId: string };
// What one request is built from, and the turns its claims may cite, by turn index.
type SubjectMaterial = { items: PersonaItem[]; recall: RecallLine[]; misses: string[]; summaryFound: PersonaItem[]; summaryOnly: string[]; turns: Map<number, CitableTurn> };
// What the material is read from: the items with their turns, the recall results, the quiz misses and the summary.
type MaterialParts = { items: readonly ItemWithTurn[]; recall: readonly RecallWithTurn[]; misses: string[]; summary: SummaryMaterial; labelOf: LabelOf };
// The number a request shows for one message: its place in one numbering of all the subject's uploads.
type LabelOf = (sourceId: string, turnIndex: number) => number;

// Asks every pending answer's persona at the same time, at most HELP_SHORTLIST_MAX of them, and stores each reply as it arrives.
// "limited" when any call met a full token window; those answers stay pending for the next run.
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
  const query = await recallQueryFor(context, ask, row);
  if (query === null) return "limited";
  const material = await readSubjectMaterial(context.db, { ask, row, query });
  if (material === null) return failAnswer(context, scope, "persona_subject_gone");
  const messages = personaAnswerMessages({ personaAnswer: prompts.personaAnswer.text, untrustedRules: prompts.untrustedRules.text }, {
    mode: ask.mode, askText: ask.text, subjectName: row.subjectDisplayName, askerName: row.askerDisplayName,
    items: material.items, recall: material.recall, misses: material.misses, summaryFound: material.summaryFound, summaryOnly: material.summaryOnly,
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

// The recall query of a friend or self ask whose card allows recall: the words the search-words call gives for the ask and the subject's
// summary topics, or the ask's own text when that call fails. Any other ask searches nothing, so it gets the ask's text without a
// call. Null when the token window is full, so the answer stays pending for the next run.
async function recallQueryFor(context: JobContext, ask: AskRow, row: AnswerRow): Promise<string | null> {
  if (ask.mode === "help") return ask.text;
  const scope = await withPerson(context.db, row.subjectPersonId, async (trx) => {
    const cardId = row.subjectCardId;
    const card = cardId === null ? undefined : await trx.selectFrom("cards").select("recall_allowed").where("id", "=", cardId).executeTakeFirst();
    return { isRecallOn: card?.recall_allowed === true, topics: summaryPriority(await readUsablePoints(trx, row.subjectPersonId, ask.mode)).topics };
  });
  if (!scope.isRecallOn) return ask.text;
  try {
    const result = await context.llm.complete({ ...searchWordsCall({ askText: ask.text, topics: scope.topics }), ledger: { personId: ask.personId, meetingId: null } });
    return searchQueryOf(result.parsed, ask.text);
  } catch (error) {
    if (error instanceof LimiterBusy) return null;
    context.log.warn({ code: error instanceof ContractError ? error.code : "search_words_failed", askId: ask.id, answerId: row.id }, "The search words failed; this answer searches with the ask's text.");
    return ask.text;
  }
}

// Reads one subject's material in the subject's own context, and only reads. Null when a help answer's listing is gone, names another
// card or, for a romance ask, has its dating switch off; when the subject's account deletion has started; when the card
// is gone or no longer approved; and, for a friend ask, when the friend has turned friend asks off since the answer row was written.
// A help answer never reads recall or the summary; a friend or self ask searches recall with the query. A subject with no approved
// card has no card to read, and the material is their summary alone.
async function readSubjectMaterial(db: Kysely<Database>, subject: { ask: AskRow; row: AnswerRow; query: string }): Promise<SubjectMaterial | null> {
  const { ask, row } = subject;
  return withPerson(db, row.subjectPersonId, async (trx) => {
    if ((await readDisplayName(trx, row.subjectPersonId)) === null) return null;
    if (ask.mode === "help" && !(await isListingCurrent(trx, ask, row))) return null;
    const summary = await readSummaryMaterial(trx, await readUsablePoints(trx, row.subjectPersonId, ask.mode));
    const cardId = row.subjectCardId;
    const labelOf = await readLabels(trx, row.subjectPersonId);
    if (cardId === null) return (await hasCardSince(trx, ask, row)) ? null : summaryOnlyMaterial(ask, summary, labelOf);
    const card = await readUsableCard(trx, ask, cardId);
    if (card === null) return null;
    const items = await readItems(trx, cardId, ask.mode === "help");
    const misses = await quizMisses(trx, cardId);
    const recall = ask.mode !== "help" && card.recall_allowed ? await readRecall(trx, cardId, subject.query) : [];
    return materialOf({ items, recall, misses, summary, labelOf });
  });
}

// One numbering of all the subject's messages: uploads in the order they came, each starting after the last message of the one
// before, so a later upload's messages get higher numbers than an earlier upload's and the prompt's "higher number is later" holds
// across uploads. Within one upload the number is the message's own place, as before.
async function readLabels(trx: DatabaseTransaction, personId: string): Promise<LabelOf> {
  const sources = await trx.selectFrom("sources").select(["id", "turn_count"]).where("person_id", "=", personId).orderBy("created_at").orderBy("id").execute();
  const starts = new Map<string, number>();
  let next = 0;
  for (const source of sources) {
    starts.set(source.id, next);
    next += source.turn_count;
  }
  return (sourceId, turnIndex) => (starts.get(sourceId) ?? 0) + turnIndex;
}

// Whether the friend of a friend ask, chosen while they had no approved card, has approved one since. Once there is a card, the card's
// own switch decides, as in friend_list(), so the summary must not answer. Their own ask never needs this.
async function hasCardSince(trx: DatabaseTransaction, ask: AskRow, row: AnswerRow): Promise<boolean> {
  if (ask.mode !== "react") return false;
  const card = await trx.selectFrom("cards").select("id").where("person_id", "=", row.subjectPersonId).where("state", "=", "approved").executeTakeFirst();
  return card !== undefined;
}

// The material of an answer whose subject has no approved card: their summary alone, for their own ask, or for a friend's ask while
// the summary's friends switch is on (readUsablePoints gives nothing when it is off, and the answer then fails as a gone subject). A
// help answer always has a card, so it gets null.
function summaryOnlyMaterial(ask: AskRow, summary: SummaryMaterial, labelOf: LabelOf): SubjectMaterial | null {
  const isEmpty = summary.found.length === 0 && summary.only.length === 0;
  if (ask.mode === "help" || (ask.mode === "react" && isEmpty)) return null;
  return materialOf({ items: [], recall: [], misses: [], summary, labelOf });
}

// The subject's card as this ask may use it, or null when it is gone, no longer approved, or, for a friend ask, has friend asks off.
async function readUsableCard(trx: DatabaseTransaction, ask: AskRow, cardId: string): Promise<{ recall_allowed: boolean } | null> {
  const card = await trx.selectFrom("cards").select(["recall_allowed", "state", "friends_can_ask"]).where("id", "=", cardId).executeTakeFirst();
  if (card === undefined || card.state !== "approved" || (ask.mode === "react" && !card.friends_can_ask)) return null;
  return card;
}

// Whether a help answer's listing still exists with the same card, and is open to dating questions when the ask is a romance one.
async function isListingCurrent(trx: DatabaseTransaction, ask: AskRow, row: AnswerRow): Promise<boolean> {
  const listingId = row.listingId;
  if (listingId === null) return false;
  const listing = await trx.selectFrom("directory_listings").select(["card_id", "open_to_romance"]).where("id", "=", listingId).executeTakeFirst();
  if (listing === undefined || listing.card_id !== row.subjectCardId) return false;
  return ask.questionKind !== "romance" || listing.open_to_romance;
}

// The card's approved, verified items in position order with the turns they quote; public ones only for a help answer.
async function readItems(trx: DatabaseTransaction, cardId: string, isPublicOnly: boolean): Promise<ItemWithTurn[]> {
  const rows = await trx.selectFrom("card_items as ci").innerJoin("turns as t", "t.id", "ci.turn_id")
    .select(["ci.kind", "ci.claim", "ci.quote", "t.id as turn_id", "t.turn_index", "t.text", "t.norm_text", "t.source_id"])
    .where("ci.card_id", "=", cardId).where("ci.approved", "=", true).where("ci.verified", "=", true)
    .$if(isPublicOnly, (query) => query.where("ci.is_public", "=", true))
    .orderBy("ci.position").execute();
  return rows.map((row) => ({
    item: { turnIndex: row.turn_index, kind: row.kind, claim: row.claim, quote: row.quote },
    turn: { turnId: row.turn_id, turnIndex: row.turn_index, text: row.text, normText: row.norm_text },
    sourceId: row.source_id,
  }));
}

// A friend's recall results for the ask's text, each turn once, in the search's order: the snippet the request shows, and the
// whole turn the quote check reads.
async function readRecall(trx: DatabaseTransaction, cardId: string, askText: string): Promise<RecallWithTurn[]> {
  const hits = await searchRecallCorpus(trx, { cardId, query: askText, limit: RECALL_TOP_K });
  if (hits.length === 0) return [];
  const turns = await trx.selectFrom("turns").select(["id", "turn_index", "text", "norm_text", "source_id"]).where("id", "in", hits.map((hit) => hit.turnId)).execute();
  const results: RecallWithTurn[] = [];
  for (const hit of hits) {
    const turn = turns.find((candidate) => candidate.id === hit.turnId);
    if (turn === undefined || results.some((result) => result.line.turnIndex === turn.turn_index)) continue;
    results.push({ line: { turnIndex: turn.turn_index, text: hit.text }, turn: { turnId: turn.id, turnIndex: turn.turn_index, text: turn.text, normText: turn.norm_text }, sourceId: turn.source_id });
  }
  return results;
}

// The request's material and the turns its claims may cite: every item's turn, then every found summary point's turn, then every recall
// turn, each numbered by readLabels, so the numbers never repeat across uploads and a higher number is a later message. A message whose
// number another message already holds is left out, as a guard: a claim citing that number would be checked against the wrong one.
function materialOf(parts: MaterialParts): SubjectMaterial {
  const numbered = (entry: { turn: CitableTurn; sourceId: string }): CitableTurn => ({ ...entry.turn, turnIndex: parts.labelOf(entry.sourceId, entry.turn.turnIndex) });
  const items = parts.items.map((entry) => ({ item: { ...entry.item, turnIndex: numbered(entry).turnIndex }, turn: numbered(entry) }));
  const turns = new Map<number, CitableTurn>();
  for (const entry of items) turns.set(entry.item.turnIndex, entry.turn);
  const isFree = (turn: CitableTurn): boolean => {
    const taken = turns.get(turn.turnIndex);
    if (taken !== undefined && taken.turnId !== turn.turnId) return false;
    turns.set(turn.turnIndex, turn);
    return true;
  };
  const found = parts.summary.found.map((entry) => ({ item: { ...entry.item, turnIndex: numbered(entry).turnIndex }, turn: numbered(entry) })).filter((entry) => isFree(entry.turn));
  const recall = parts.recall.map((entry) => ({ line: { ...entry.line, turnIndex: numbered(entry).turnIndex }, turn: numbered(entry) })).filter((entry) => isFree(entry.turn));
  return {
    items: items.map((entry) => entry.item), recall: recall.map((entry) => entry.line), misses: parts.misses,
    summaryFound: found.map((entry) => entry.item), summaryOnly: parts.summary.only, turns,
  };
}
