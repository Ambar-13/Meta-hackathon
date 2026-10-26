import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDatabase, POOL_SIZE, withMeeting, withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import { createApprovedCard, createFrozenSource, createTestPerson, freshTestDatabase, readTestDatabaseUrls, sha256Text, type TestDatabase } from "@meet-first/db/testing";
import { countPersonRows, PERSON_TABLES } from "./table-list.js";

// The superuser connection to the test database. It sees every row, so the coverage reads are not limited by row security.
function superUser(): Kysely<Database> {
  const urls = readTestDatabaseUrls(process.env);
  const url = new URL(urls.adminUrl);
  url.pathname = new URL(urls.migrateUrl).pathname;
  return makeDatabase(url.toString(), 1);
}

// Returns the element at index, and throws when the list is shorter than that.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The list has no item at index ${String(index)}.`);
  return item;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const TURNS_A = ["I write the plan down before a big meeting.", "Deadlines matter to me, so I tell the team the same day.", "On weekends I hike with my sister.", "I keep my phone out of the room when I think."];
const TURNS_B = ["Deadlines guide me; the work being right matters more.", "I think out loud with the team before I decide.", "When plans change late I need a day to adjust.", "I ask one clarifying question before I start."];

// One person of the seeded scenario, with the ids the rows of their own side point at.
type SeededSide = { personId: string; sourceId: string; turnIds: string[]; cardId: string };
// The seeded scenario: two people, one pair, one ended meeting, and the ledger ids the tests read back.
type Scenario = { a: SeededSide; b: SeededSide; pairId: string; meetingId: string; ledgerIds: string[] };

let database: TestDatabase;
let workerDb: Kysely<Database>;
let owner: Kysely<Database>;
let scenario: Scenario;

// Creates one person with a frozen four-turn source, a six-item approved card and the rows the person owns alone.
async function seedSide(db: Kysely<Database>, name: string, turns: string[]): Promise<SeededSide> {
  const person = await createTestPerson(db, name);
  const source = await createFrozenSource(db, person.personId, turns);
  const card = await createApprovedCard(db, source.sourceId, { items: 6 });
  await withPerson(db, person.personId, async (trx) => {
    await trx.insertInto("sessions").values({ person_id: person.personId, token_hash: sha256Text(randomUUID()), expires_at: new Date(Date.now() + 90 * 24 * HOUR_MS) }).execute();
    await trx.insertInto("transfer_links").values({ person_id: person.personId, token_hash: sha256Text(randomUUID()), expires_at: new Date(Date.now() + 10 * MINUTE_MS) }).execute();
    await trx.insertInto("redactions").values([0, 1].map((index) => ({ source_id: source.sourceId, turn_id: at(source.turnIds, index), person_id: person.personId, category: "email", placeholder_id: `r000000${String(index + 1)}` }))).execute();
    const quiz = await trx.insertInto("quizzes").values({ card_id: card.cardId, person_id: person.personId, bank_version: 1, seed: "seed-test", state: "answering" }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("quiz_items").values(Array.from({ length: 10 }, (item, index) => ({ quiz_id: quiz.id, person_id: person.personId, position: index + 1, bank_version: 1, question_id: index + 1, persona_answer: "Test answer", flipped: false }))).execute();
  });
  return { personId: person.personId, sourceId: source.sourceId, turnIds: source.turnIds, cardId: card.cardId };
}

// Writes the rows of the meeting that both sides share: steps, events, claims, briefs, a comic with six panels and a published share page.
async function writeMeetingRows(db: Kysely<Database>, meetingId: string, sides: { a: SeededSide; b: SeededSide }): Promise<void> {
  await withMeeting(db, meetingId, async (trx) => {
    const output = JSON.stringify({ text: "Test turn", toolCalls: [], claimsCommitted: 1 });
    await trx.insertInto("meeting_steps").values([
      { meeting_id: meetingId, step_seq: 1, side: "a", phase: "open", state: "done", output },
      { meeting_id: meetingId, step_seq: 2, side: "b", phase: "explore", state: "done", output },
      { meeting_id: meetingId, step_seq: 3, side: "a", phase: "decide", state: "done", output },
    ]).execute();
    for (const [index, type] of ["meeting.started", "phase.changed", "turn.committed", "tool.called", "tool.result", "turn.committed", "concede", "meeting.ended"].entries()) {
      await trx.insertInto("meeting_events").values({ meeting_id: meetingId, seq: index + 1, type, v: 1, payload: JSON.stringify({}) }).execute();
    }
    await trx.insertInto("claims").values([
      { meeting_id: meetingId, step_seq: 1, side: "a", person_id: sides.a.personId, position: 1, text: "Plans first", quote: at(TURNS_A, 0), lang: "en", turn_id: at(sides.a.turnIds, 0), verified: true, flagged: false, evidence_valid: true },
      { meeting_id: meetingId, step_seq: 1, side: "a", person_id: sides.a.personId, position: 2, text: "Deadlines", quote: at(TURNS_A, 1), lang: "en", turn_id: at(sides.a.turnIds, 1), verified: true, flagged: false, evidence_valid: true },
      { meeting_id: meetingId, step_seq: 2, side: "b", person_id: sides.b.personId, position: 1, text: "Work first", quote: at(TURNS_B, 0), lang: "en", turn_id: at(sides.b.turnIds, 0), verified: true, flagged: false, evidence_valid: true },
      { meeting_id: meetingId, step_seq: 2, side: "b", person_id: sides.b.personId, position: 2, text: "Out loud", quote: at(TURNS_B, 1), lang: "en", turn_id: at(sides.b.turnIds, 1), verified: true, flagged: false, evidence_valid: true },
    ]).execute();
    for (const person of [sides.a.personId, sides.b.personId]) {
      await trx.insertInto("briefs").values({ meeting_id: meetingId, person_id: person, agree: JSON.stringify([]), clash: JSON.stringify([]), decide_first: JSON.stringify([]), model: "test-model", prompt_version: "test" }).execute();
    }
    const comic = await trx.insertInto("comics").values({ meeting_id: meetingId, requested_by: sides.a.personId, state: "ready", avatar_a: "avatar-a", avatar_b: "avatar-b", prompt_version: "test", purge_after: new Date(Date.now() + 30 * 24 * HOUR_MS), finished_at: new Date() }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("comic_panels").values(Array.from({ length: 6 }, (item, index) => ({ comic_id: comic.id, meeting_id: meetingId, position: index + 1, caption: `Panel ${String(index + 1)}`, image_prompt: "Test panel", image: Buffer.from([1, 2, 3]) }))).execute();
    await trx.insertInto("share_pages").values({ meeting_id: meetingId, slug: `test-${randomUUID()}`, consent_a: true, consent_b: true, published: true, published_at: new Date() }).execute();
  });
}

// Builds the whole scenario the coverage and count tests read: two people, a joined pair, an ended meeting and its rows.
async function seedScenario(db: Kysely<Database>, worker: Kysely<Database>): Promise<Scenario> {
  const a = await seedSide(db, "Test A", TURNS_A);
  const b = await seedSide(db, "Test B", TURNS_B);
  const pair = await withPerson(db, a.personId, (trx) => trx.insertInto("pairs").values({ creator_person_id: a.personId, joiner_person_id: b.personId, token_hash: sha256Text(randomUUID()), expires_at: new Date(Date.now() + 24 * HOUR_MS), joined_at: new Date() }).returning("id").executeTakeFirstOrThrow());
  const created = await sql<{ meeting_id: string | null }>`SELECT meeting_create(${pair.id}::uuid, ${a.personId}::uuid, ${a.cardId}::uuid, 3, ${"Test question"}, true) AS meeting_id`.execute(db);
  const meetingId = created.rows[0]?.meeting_id;
  if (meetingId === null || meetingId === undefined) throw new Error("meeting_create returned no id.");
  await withMeeting(db, meetingId, async (trx) => {
    await trx.updateTable("meetings").set({ state: "running", started_at: new Date(), ends_at: new Date(Date.now() + 10 * MINUTE_MS) }).where("id", "=", meetingId).execute();
    await trx.updateTable("meetings").set({ state: "ended", ended_at: new Date(), end_reason: "decided" }).where("id", "=", meetingId).execute();
  });
  await writeMeetingRows(db, meetingId, { a, b });
  const ledgerIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const row = await withPerson(worker, a.personId, (trx) => trx.insertInto("ledger").values({ person_id: a.personId, call_site: "speech", model: "test-model", effort: "low", est_tokens: 10, status: "ok", llm_mode: "replay" }).returning("id").executeTakeFirstOrThrow());
    ledgerIds.push(row.id);
  }
  for (let index = 0; index < 3; index += 1) {
    const row = await withMeeting(worker, meetingId, (trx) => trx.insertInto("ledger").values({ meeting_id: meetingId, call_site: "speech", model: "test-model", effort: "low", est_tokens: 10, status: "ok", llm_mode: "replay" }).returning("id").executeTakeFirstOrThrow());
    ledgerIds.push(row.id);
  }
  await withPerson(db, a.personId, (trx) => trx.insertInto("deletions").values({ person_id: a.personId, requested_at: new Date() }).execute());
  return { a, b, pairId: pair.id, meetingId, ledgerIds };
}

beforeAll(async () => {
  database = await freshTestDatabase();
  workerDb = makeDatabase(database.workerUrl, POOL_SIZE.test);
  owner = superUser();
  scenario = await seedScenario(database.db, workerDb);
});

afterAll(async () => {
  await owner.destroy();
  await workerDb.destroy();
  await database.drop();
});

// The row counts of the seeded person a that the deletion must clear, keyed as countPersonRows keys them. briefs is 1: the person's own transaction sees only their own brief (as-built item 1).
const EXPECTED_COUNTS = { sources: 1, turns: 4, redactions: 2, cards: 1, card_items: 6, quizzes: 1, quiz_items: 10, sessions: 2, transfer_links: 1, pairs: 1, meetings: 1, meeting_members: 2, meeting_steps: 3, meeting_events: 8, claims: 4, briefs: 1, comics: 1, comic_panels: 6, share_pages: 1, ledger_nulled: 6, people: 1, names_passes: 1, source_names: 0 };

// The names of the base tables (not views, which hold no rows) that have a column with the given name, read from the catalog as the superuser.
async function tablesWithColumn(columnName: string): Promise<string[]> {
  const rows = await sql<{ table_name: string }>`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = ${columnName} ORDER BY c.table_name`.execute(owner);
  return rows.rows.map((row) => row.table_name);
}

describe("table list", () => {
  it("W2-DEL-T1 (invariant 16): every table in information_schema with a person_id column is in PERSON_TABLES", async () => {
    const withPersonId = await tablesWithColumn("person_id");
    const listed = PERSON_TABLES.map((entry) => entry.table);
    const realTables = await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`.execute(owner);
    const realNames = new Set(realTables.rows.map((row) => row.table_name));

    expect(withPersonId.filter((name) => !listed.includes(name))).toEqual([]);
    expect(listed.filter((name) => !realNames.has(name))).toEqual([]);
  });

  it("W2-DEL-T2 (invariant 16): every table with a meeting_id column is reached by meeting_id or by comic_id in PERSON_TABLES, or is the ledger, whose rows stay with the ids cleared (D69)", async () => {
    const withMeetingId = await tablesWithColumn("meeting_id");
    const unreached = withMeetingId.filter((name) => {
      const entry = PERSON_TABLES.find((candidate) => candidate.table === name);
      return entry === undefined || (entry.reach !== "meeting_id" && entry.reach !== "comic_id" && entry.reach !== "ledger_nulled");
    });

    expect(unreached).toEqual([]);
  });

  it("W2-DEL-T3: countPersonRows on the seed returns the seeded numbers", async () => {
    const counts = await withPerson(workerDb, scenario.a.personId, (trx: DatabaseTransaction) => countPersonRows(trx, scenario.a.personId));

    expect(counts).toEqual(EXPECTED_COUNTS);
    expect(Object.keys(counts)).not.toContain("deletions");
  });
});
