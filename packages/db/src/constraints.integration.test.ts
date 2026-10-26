import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { normQuote } from "@meet-first/receipts";
import { makeDatabase } from "./client.js";
import { parseDatabaseError } from "./database-errors.js";
import { asMeeting, asPerson, createApprovedCard, createFrozenSource, createPairedMeetingWithTurns, createTestPerson, freshTestDatabase, sha256Text, SEED_TURNS_A, type SeededMeeting, type TestDatabase } from "./testing/index.js";
import type { Database } from "./types.js";

let t: TestDatabase;
let worker: Kysely<Database>;

// Returns the item at index, and throws when the list is shorter.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The list has no item at index ${String(index)}.`);
  return item;
}

// The error an action throws, or undefined when it succeeds.
async function caughtFrom(act: () => Promise<unknown>): Promise<unknown> {
  return act().then(() => undefined, (caught: unknown) => caught);
}

// The Postgres code read off a thrown value, or undefined.
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
}

// A person with one frozen source and one approved card.
async function createPersonWithCard(db: Kysely<Database>, name: string): Promise<{ personId: string; sourceId: string; turnIds: string[]; cardId: string }> {
  const { personId } = await createTestPerson(db, name);
  const source = await createFrozenSource(db, personId, ["A turn for a person who needs a card here."]);
  const card = await createApprovedCard(db, source.sourceId);
  return { personId, sourceId: source.sourceId, turnIds: source.turnIds, cardId: card.cardId };
}

// A pair with the creator's invite joined by the joiner, through the same functions the routes use.
async function joinedPair(db: Kysely<Database>, creatorId: string, joinerId: string): Promise<string> {
  const token = randomBytes(16).toString("hex");
  const pair = await asPerson(db, creatorId, (trx) => trx.insertInto("pairs").values({ creator_person_id: creatorId, token_hash: sha256Text(token), expires_at: new Date(Date.now() + 24 * 3_600_000) }).returning("id").executeTakeFirstOrThrow());
  await sql`SELECT pairs_join(${sha256Text(token)}, ${joinerId}::uuid) AS pair_id`.execute(db);
  return pair.id;
}

// One quiz for a side's card, with a single question and no answers yet.
async function quizWithItem(db: Kysely<Database>, side: SeededMeeting["a"]): Promise<string> {
  return asPerson(db, side.personId, async (trx) => {
    const quiz = await trx.insertInto("quizzes").values({ card_id: side.cardId, person_id: side.personId, bank_version: 1, seed: side.cardId, state: "answering" }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("quiz_items").values({ quiz_id: quiz.id, person_id: side.personId, position: 1, bank_version: 1, question_id: 1, flipped: false }).execute();
    return quiz.id;
  });
}

// The sources row a seed inserts for one person, with a chosen hash.
function sourceRow(personId: string, hashText: string) {
  return { person_id: personId, kind: "paste" as const, content_hash: sha256Text(hashText), turn_count: 1, canonical_chars: 20, persona_signal: "0.500", parser_version: "test", scrub_version: "test", attested_at: new Date() };
}

beforeAll(async () => {
  t = await freshTestDatabase();
  worker = makeDatabase(t.workerUrl, 1);
});

afterAll(async () => {
  await worker.destroy();
  await t.drop();
});

describe("constraints", () => {
  it("INV1-T7: refuses a turn whose role is not user", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => sql`INSERT INTO turns (source_id, person_id, turn_index, role, text, norm_text) VALUES (${m.a.sourceId}, ${m.a.personId}, 10, 'assistant', 'An assistant turn that must not be stored.', 'an assistant turn that must not be stored')`.execute(trx)));

    expect(codeOf(error)).toBe("23514");
    expect(parseDatabaseError(error)).toBeNull();
  });

  it("INV1-T8: refuses a turn without norm_text", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => sql`INSERT INTO turns (source_id, person_id, turn_index, role, text, norm_text) VALUES (${m.a.sourceId}, ${m.a.personId}, 11, 'user', 'A turn without a normalised text.', NULL)`.execute(trx)));

    expect(codeOf(error)).toBe("23502");
  });

  it("INV2-T1: refuses a second source with the same content hash for one person", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await asPerson(t.db, m.a.personId, (trx) => trx.insertInto("sources").values(sourceRow(m.a.personId, "same canonical turns")).execute());
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => trx.insertInto("sources").values(sourceRow(m.a.personId, "same canonical turns")).execute()));

    expect(codeOf(error)).toBe("23505");
    expect(parseDatabaseError(error)).toEqual({ code: "duplicate", message: "This already exists. Use the one that is there instead of making another." });
  });

  it("INV2-T2: allows the same content hash for another person", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const row = await asPerson(t.db, m.b.personId, (trx) => trx.insertInto("sources").values(sourceRow(m.b.personId, "same canonical turns")).returning("id").executeTakeFirstOrThrow());

    expect(typeof row.id).toBe("string");
  });

  it("INV3-T1: refuses a placeholder id used twice in one source", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const redaction = () => asPerson(t.db, m.a.personId, (trx) => trx.insertInto("redactions").values({ source_id: m.a.sourceId, turn_id: at(m.a.turnIds, 0), person_id: m.a.personId, category: "phone", placeholder_id: "0a0b0c0d" }).execute());
    await redaction();
    const error = await caughtFrom(redaction);

    expect(parseDatabaseError(error)).toEqual({ code: "duplicate", message: "This already exists. Use the one that is there instead of making another." });
  });

  it("INV3-T2: no column anywhere stores a redaction count", async () => {
    const result = await sql<{ table_name: string; column_name: string }>`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name LIKE '%redaction%'`.execute(t.db);

    expect(result.rows).toEqual([]);
  });

  it("INV5-T3: refuses a card item that is neither verified nor flagged", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => trx.insertInto("card_items").values({ card_id: m.a.cardId, person_id: m.a.personId, position: 8, kind: "value", claim: "Test claim 8", lang: "en", gloss: "Test gloss 8", turn_id: at(m.a.turnIds, 0), quote: at(SEED_TURNS_A, 0), norm_quote: normQuote(at(SEED_TURNS_A, 0)), verified: false, flagged: false }).execute()));

    expect(codeOf(error)).toBe("23514");
    expect(parseDatabaseError(error)).toBeNull();
  });

  it("INV6-T3: refuses a claim that is neither verified nor flagged", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(t.db, m.meetingId, (trx) => trx.insertInto("claims").values({ meeting_id: m.meetingId, step_seq: 1, side: "a", person_id: m.a.personId, position: 1, text: "A claim with no check.", quote: at(SEED_TURNS_A, 0), lang: "en", turn_id: at(m.a.turnIds, 0), verified: false, flagged: false, evidence_valid: true }).execute()));

    expect(codeOf(error)).toBe("23514");
  });

  it("INV7-T1: refuses a human answer before the persona answer", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const quizId = await quizWithItem(t.db, m.a);
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => trx.updateTable("quiz_items").set({ human_answer: "My own answer." }).where("quiz_id", "=", quizId).where("position", "=", 1).execute()));

    expect(codeOf(error)).toBe("23514");
    expect(parseDatabaseError(error)).toEqual({ code: "persona_answer_missing", message: "The persona has not answered this question yet. Wait a moment and reload." });
  });

  it("INV7-T2: allows a human answer once the persona answered", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const quizId = await quizWithItem(t.db, m.a);
    const persona = await asPerson(t.db, m.a.personId, (trx) => trx.updateTable("quiz_items").set({ persona_answer: "The persona's answer." }).where("quiz_id", "=", quizId).where("position", "=", 1).execute());
    const human = await asPerson(t.db, m.a.personId, (trx) => trx.updateTable("quiz_items").set({ human_answer: "My own answer." }).where("quiz_id", "=", quizId).where("position", "=", 1).execute());

    expect([...persona, ...human].map((row) => row.numUpdatedRows)).toEqual([1n, 1n]);
  });

  it("INV7-T3: refuses a human answer longer than 200 characters", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const quizId = await quizWithItem(t.db, m.a);
    await asPerson(t.db, m.a.personId, (trx) => trx.updateTable("quiz_items").set({ persona_answer: "The persona's answer." }).where("quiz_id", "=", quizId).where("position", "=", 1).execute());
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => trx.updateTable("quiz_items").set({ human_answer: "x".repeat(201) }).where("quiz_id", "=", quizId).where("position", "=", 1).execute()));

    expect(codeOf(error)).toBe("23514");
    expect(parseDatabaseError(error)).toBeNull();
  });

  it("INV8-T1: refuses a pair whose creator is also its joiner", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => trx.insertInto("pairs").values({ creator_person_id: m.a.personId, joiner_person_id: m.a.personId, token_hash: sha256Text("self-pair"), expires_at: new Date(Date.now() + 24 * 3_600_000) }).execute()));

    expect(codeOf(error)).toBe("23514");
  });

  it("INV8-T2: refuses a second pair with a used invite hash", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asPerson(t.db, m.a.personId, (trx) => trx.insertInto("pairs").values({ creator_person_id: m.a.personId, token_hash: sha256Text(m.inviteToken), expires_at: new Date(Date.now() + 24 * 3_600_000) }).execute()));

    expect(parseDatabaseError(error)).toEqual({ code: "duplicate", message: "This already exists. Use the one that is there instead of making another." });
  });

  it("INV8-T3: refuses a second member on one side of a meeting", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const c = await createPersonWithCard(t.db, "Test C");
    const error = await caughtFrom(() => asMeeting(worker, m.meetingId, (trx) => trx.insertInto("meeting_members").values({ meeting_id: m.meetingId, person_id: c.personId, side: "a", card_id: c.cardId }).execute()));

    expect(parseDatabaseError(error)).toEqual({ code: "duplicate", message: "This already exists. Use the one that is there instead of making another." });
  });

  it("INV8-T4: refuses one person twice in one meeting", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(worker, m.meetingId, async (trx) => {
      await trx.deleteFrom("meeting_members").where("person_id", "=", m.b.personId).execute();
      await trx.insertInto("meeting_members").values({ meeting_id: m.meetingId, person_id: m.a.personId, side: "b", card_id: m.a.cardId }).execute();
    }));

    expect(parseDatabaseError(error)).toEqual({ code: "duplicate", message: "This already exists. Use the one that is there instead of making another." });
  });

  it("INV8-T5: meeting_create refuses a pair nobody joined", async () => {
    const c = await createPersonWithCard(t.db, "Test C");
    const pair = await asPerson(t.db, c.personId, (trx) => trx.insertInto("pairs").values({ creator_person_id: c.personId, token_hash: sha256Text(randomUUID()), expires_at: new Date(Date.now() + 24 * 3_600_000) }).returning("id").executeTakeFirstOrThrow());
    const error = await caughtFrom(() => sql`SELECT meeting_create(${pair.id}::uuid, ${c.personId}::uuid, ${c.cardId}::uuid, 1, 'A test question for the pair.', true)`.execute(t.db));

    expect(parseDatabaseError(error)).toEqual({ code: "pair_not_joined", message: "the other person has not joined this pair yet." });
  });

  it("INV8-T6: meeting_create refuses a card that is not approved", async () => {
    const c = await createPersonWithCard(t.db, "Test C");
    const d = await createPersonWithCard(t.db, "Test D");
    const pairId = await joinedPair(t.db, c.personId, d.personId);
    await asPerson(t.db, c.personId, (trx) => trx.updateTable("cards").set({ state: "ready" }).where("id", "=", c.cardId).execute());
    const error = await caughtFrom(() => sql`SELECT meeting_create(${pairId}::uuid, ${c.personId}::uuid, ${c.cardId}::uuid, 1, 'A test question for the pair.', true)`.execute(t.db));

    expect(parseDatabaseError(error)).toEqual({ code: "card_not_approved", message: "approve your card before creating a meeting." });
  });

  it("INV8-T7: meeting_create refuses when the other person has no approved card", async () => {
    const c = await createPersonWithCard(t.db, "Test C");
    const d = await createTestPerson(t.db, "Test D");
    const pairId = await joinedPair(t.db, c.personId, d.personId);
    const error = await caughtFrom(() => sql`SELECT meeting_create(${pairId}::uuid, ${c.personId}::uuid, ${c.cardId}::uuid, 1, 'A test question for the pair.', true)`.execute(t.db));

    expect(parseDatabaseError(error)).toEqual({ code: "other_card_missing", message: "the other person has no approved card yet." });
  });

  it("INV10-T1: refuses a second step with one seq", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const step = () => asMeeting(t.db, m.meetingId, (trx) => trx.insertInto("meeting_steps").values({ meeting_id: m.meetingId, step_seq: 1, side: "a", phase: "open" }).execute());
    await step();
    const error = await caughtFrom(step);

    expect(parseDatabaseError(error)).toEqual({ code: "duplicate", message: "This already exists. Use the one that is there instead of making another." });
  });

  it("INV10-T2: refuses a done step without output", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(t.db, m.meetingId, (trx) => trx.insertInto("meeting_steps").values({ meeting_id: m.meetingId, step_seq: 2, side: "b", phase: "open", state: "done" }).execute()));

    expect(codeOf(error)).toBe("23514");
  });

  it("INV10-T3: refuses output on a step that is not done", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(t.db, m.meetingId, (trx) => trx.insertInto("meeting_steps").values({ meeting_id: m.meetingId, step_seq: 3, side: "a", phase: "open", output: JSON.stringify({ text: "x" }) }).execute()));

    expect(codeOf(error)).toBe("23514");
  });

  it("INV10-T4: refuses a step state outside the four", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(t.db, m.meetingId, (trx) => sql`INSERT INTO meeting_steps (meeting_id, step_seq, side, phase, state) VALUES (${m.meetingId}, 4, 'b', 'open', 'paused')`.execute(trx)));

    expect(codeOf(error)).toBe("23514");
  });

  it("INV10-T5: refuses more than five tool rounds", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(t.db, m.meetingId, (trx) => trx.insertInto("meeting_steps").values({ meeting_id: m.meetingId, step_seq: 5, side: "a", phase: "explore", tool_rounds: 6 }).execute()));

    expect(codeOf(error)).toBe("23514");
  });

  it("INV13-T1: refuses a published page without both consents", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(t.db, m.meetingId, (trx) => trx.insertInto("share_pages").values({ meeting_id: m.meetingId, slug: "slug-inv13-1", published: true }).execute()));

    expect(codeOf(error)).toBe("23514");
  });

  it("INV13-T2: publishes a page when both consents stand", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const row = await asMeeting(t.db, m.meetingId, (trx) => trx.insertInto("share_pages").values({ meeting_id: m.meetingId, slug: "slug-inv13-2", consent_a: true, consent_b: true, published: true }).returning("id").executeTakeFirstOrThrow());

    expect(typeof row.id).toBe("string");
  });

  it("INV14-T1: refuses a negative token estimate", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() => asMeeting(worker, m.meetingId, (trx) => trx.insertInto("ledger").values({ meeting_id: m.meetingId, call_site: "speech", model: "test-model", effort: "low", est_tokens: -1, status: "started", llm_mode: "replay" }).execute()));

    expect(codeOf(error)).toBe("23514");
  });
});
