import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countRowsForPerson, makeDatabase, POOL_SIZE, withMeeting, withPerson, type Database } from "@meet-first/db";
import { countVisibleRows, createApprovedCard, createFrozenSource, createTestPerson, freshTestDatabase, readTestDatabaseUrls, sha256Text, type TestDatabase } from "@meet-first/db/testing";
import { makeTestJobContext } from "../testing/index.js";
import { runMeetingStep } from "../meetings/step-job.js";
import { deletePersonTask } from "./delete-person-job.js";
import { countPersonRows } from "./table-list.js";

// The superuser connection to the test database. It sees every row, so the checks are not limited by row security.
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
// The seeded scenario: two people, one pair, one ended meeting, and the ledger ids the checks read back.
type Scenario = { a: SeededSide; b: SeededSide; pairId: string; meetingId: string; ledgerIds: string[] };

let database: TestDatabase;
let workerDb: Kysely<Database>;
let owner: Kysely<Database>;

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

// Creates a pair with the joiner already in it, so a meeting may be made on it.
async function createJoinedPair(db: Kysely<Database>, creator: string, joiner: string): Promise<string> {
  const pair = await withPerson(db, creator, (trx) => trx.insertInto("pairs").values({ creator_person_id: creator, joiner_person_id: joiner, token_hash: sha256Text(randomUUID()), expires_at: new Date(Date.now() + 24 * HOUR_MS), joined_at: new Date() }).returning("id").executeTakeFirstOrThrow());
  return pair.id;
}

// Makes one ready meeting on a joined pair through meeting_create, and returns its id.
async function createMeeting(db: Kysely<Database>, meeting: { pairId: string; me: string; myCard: string; questionText: string }): Promise<string> {
  const created = await sql<{ meeting_id: string | null }>`SELECT meeting_create(${meeting.pairId}::uuid, ${meeting.me}::uuid, ${meeting.myCard}::uuid, 3, ${meeting.questionText}, true) AS meeting_id`.execute(db);
  const meetingId = created.rows[0]?.meeting_id;
  if (meetingId === null || meetingId === undefined) throw new Error("meeting_create returned no id.");
  return meetingId;
}

// Moves a ready meeting to running, the way the start rule does.
async function setRunning(db: Kysely<Database>, meetingId: string): Promise<void> {
  await withMeeting(db, meetingId, (trx) => trx.updateTable("meetings").set({ state: "running", started_at: new Date(), ends_at: new Date(Date.now() + 10 * MINUTE_MS) }).where("id", "=", meetingId).execute());
}

// Writes the rows of the meeting both sides share: steps, events, claims, briefs, a comic with six panels and a published share page.
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

// Builds one full scenario: two people, a joined pair, an ended meeting with its rows, six ledger rows and a deletions row for a.
async function freshScenario(): Promise<Scenario> {
  const a = await seedSide(database.db, "Test A", TURNS_A);
  const b = await seedSide(database.db, "Test B", TURNS_B);
  const pairId = await createJoinedPair(database.db, a.personId, b.personId);
  const meetingId = await createMeeting(database.db, { pairId, me: a.personId, myCard: a.cardId, questionText: "Test question" });
  await setRunning(database.db, meetingId);
  await withMeeting(database.db, meetingId, (trx) => trx.updateTable("meetings").set({ state: "ended", ended_at: new Date(), end_reason: "decided" }).where("id", "=", meetingId).execute());
  await writeMeetingRows(database.db, meetingId, { a, b });
  const ledgerIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const row = await withPerson(workerDb, a.personId, (trx) => trx.insertInto("ledger").values({ person_id: a.personId, call_site: "speech", model: "test-model", effort: "low", est_tokens: 10, status: "ok", llm_mode: "replay" }).returning("id").executeTakeFirstOrThrow());
    ledgerIds.push(row.id);
  }
  for (let index = 0; index < 3; index += 1) {
    const row = await withMeeting(workerDb, meetingId, (trx) => trx.insertInto("ledger").values({ meeting_id: meetingId, call_site: "speech", model: "test-model", effort: "low", est_tokens: 10, status: "ok", llm_mode: "replay" }).returning("id").executeTakeFirstOrThrow());
    ledgerIds.push(row.id);
  }
  await withPerson(database.db, a.personId, (trx) => trx.insertInto("deletions").values({ person_id: a.personId, requested_at: new Date() }).execute());
  return { a, b, pairId, meetingId, ledgerIds };
}

// The row counts a fully deleted person shows: the same keys as the seeded counts, all at zero.
const ZERO_COUNTS = { sources: 0, turns: 0, redactions: 0, cards: 0, card_items: 0, quizzes: 0, quiz_items: 0, sessions: 0, transfer_links: 0, pairs: 0, meetings: 0, meeting_members: 0, meeting_steps: 0, meeting_events: 0, claims: 0, briefs: 0, comics: 0, comic_panels: 0, share_pages: 0, ledger_nulled: 0, people: 0, names_passes: 0, source_names: 0, directory_listings: 0, persona_asks: 0, persona_answers: 0, friend_requests: 0, orchestrator_messages: 0, posts: 0, post_likes: 0, profile_photos: 0, google_accounts: 0, person_summaries: 0 };

// The counts the record of a's deletion must hold, as the seed gives them (T3 in table-list.integration.test.ts).
// briefs is 1: the person's own transaction sees only their own brief.
const SEEDED_COUNTS = { sources: 1, turns: 4, redactions: 2, cards: 1, card_items: 6, quizzes: 1, quiz_items: 10, sessions: 2, transfer_links: 1, pairs: 1, meetings: 1, meeting_members: 2, meeting_steps: 3, meeting_events: 8, claims: 4, briefs: 1, comics: 1, comic_panels: 6, share_pages: 1, ledger_nulled: 6, people: 1, names_passes: 1, source_names: 0, directory_listings: 0, persona_asks: 0, persona_answers: 0, friend_requests: 0, orchestrator_messages: 0, posts: 0, post_likes: 0, profile_photos: 0, google_accounts: 0, person_summaries: 0 };

// Context for the delete job: the worker connection, a recording enqueue and a silent log.
function jobContext(): ReturnType<typeof makeTestJobContext> {
  return makeTestJobContext({ db: workerDb });
}

beforeAll(async () => {
  database = await freshTestDatabase();
  workerDb = makeDatabase(database.workerUrl, POOL_SIZE.test);
  owner = superUser();
});

afterAll(async () => {
  await owner.destroy();
  await workerDb.destroy();
  await database.drop();
});

describe("delete person job", () => {
  it("W2-DEL-T4 (D69, R9.6): after delete_person every table has zero rows for the person, including ledger.person_id", async () => {
    const s = await freshScenario();
    await deletePersonTask({ personId: s.a.personId }, jobContext().context);

    const counts = await withPerson(workerDb, s.a.personId, (trx) => countPersonRows(trx, s.a.personId));
    expect(counts).toEqual(ZERO_COUNTS);
    const people = await sql<{ n: string }>`SELECT count(*) AS n FROM people WHERE id = ${s.a.personId}::uuid`.execute(owner);
    expect(people.rows[0]?.n).toBe("0");
    const ledgerOfA = await sql<{ n: string }>`SELECT count(*) AS n FROM ledger WHERE person_id = ${s.a.personId}::uuid`.execute(owner);
    expect(ledgerOfA.rows[0]?.n).toBe("0");
    const ledgerKept = await sql<{ n: string }>`SELECT count(*) AS n FROM ledger WHERE id = ANY(${s.ledgerIds}::uuid[]) AND person_id IS NULL AND meeting_id IS NULL`.execute(owner);
    expect(ledgerKept.rows[0]?.n).toBe("6");
    const cleared = await countRowsForPerson(workerDb, s.a.personId);
    expect(Object.values(cleared).every((count) => count === 0)).toBe(true);
    const record = await sql<{ completed_at: Date | null; counts: Record<string, number> | null }>`SELECT completed_at, counts FROM deletions WHERE person_id = ${s.a.personId}::uuid`.execute(owner);
    expect(record.rows[0]?.completed_at).not.toBeNull();
    expect(record.rows[0]?.counts).toEqual(SEEDED_COUNTS);
  });

  it("W2-DEL-T5 (R9.6): a step job that wakes on a deleted meeting returns success", async () => {
    const s = await freshScenario();
    const second = await createMeeting(database.db, { pairId: s.pairId, me: s.a.personId, myCard: s.a.cardId, questionText: "Second question" });
    await setRunning(database.db, second);
    await withMeeting(database.db, second, (trx) => trx.insertInto("meeting_steps").values({ meeting_id: second, step_seq: 2, side: "b", phase: "explore", state: "pending" }).execute());
    const context = jobContext();
    await deletePersonTask({ personId: s.a.personId }, context.context);

    await expect(runMeetingStep({ meetingId: second, stepSeq: 2 }, context.context)).resolves.toBeUndefined();
    expect(context.enqueued).toEqual([]);
    const events = await sql<{ n: string }>`SELECT count(*) AS n FROM meeting_events WHERE meeting_id = ${second}::uuid`.execute(owner);
    expect(events.rows[0]?.n).toBe("0");
  });

  it("W2-DEL-T6 (R9.7): the other member keeps source and card and loses meeting, brief and share page; the share link is gone", async () => {
    const s = await freshScenario();
    const slugRow = await sql<{ slug: string }>`SELECT slug FROM share_pages WHERE meeting_id = ${s.meetingId}::uuid`.execute(owner);
    const slug = slugRow.rows[0]?.slug ?? "";
    await deletePersonTask({ personId: s.a.personId }, jobContext().context);

    const kept = await withPerson(workerDb, s.b.personId, async (trx) => ({
      sources: await countVisibleRows(trx, "sources"), cards: await countVisibleRows(trx, "cards"), cardItems: await countVisibleRows(trx, "card_items"), quizzes: await countVisibleRows(trx, "quizzes"),
      meetings: await countVisibleRows(trx, "meetings"), briefs: await countVisibleRows(trx, "briefs"), sharePages: await countVisibleRows(trx, "share_pages"), comics: await countVisibleRows(trx, "comics"),
    }));
    expect(kept).toEqual({ sources: 1, cards: 1, cardItems: 6, quizzes: 1, meetings: 0, briefs: 0, sharePages: 0, comics: 0 });
    const page = await sql<{ page: unknown }>`SELECT share_read(${slug}) AS page`.execute(database.db);
    expect(page.rows[0]?.page ?? null).toBeNull();
  });

  it("W2-DEL-T7 (D69 idempotency): running the job twice leaves one completed deletions row and throws nothing", async () => {
    const s = await freshScenario();
    await deletePersonTask({ personId: s.a.personId }, jobContext().context);

    await expect(deletePersonTask({ personId: s.a.personId }, jobContext().context)).resolves.toBeUndefined();
    const rows = await sql<{ n: string; completed: string }>`SELECT count(*) AS n, count(completed_at) AS completed FROM deletions WHERE person_id = ${s.a.personId}::uuid`.execute(owner);
    expect(rows.rows[0]?.n).toBe("1");
    expect(rows.rows[0]?.completed).toBe("1");
  });

  it("W2-DEL-T8 (D69): a person who was never marked deleted is marked by the job before the cascade", async () => {
    const solo = await createTestPerson(database.db, "Test Solo");
    const before = await sql<{ state: string }>`SELECT state FROM people WHERE id = ${solo.personId}::uuid`.execute(owner);
    expect(before.rows[0]?.state).toBe("active");

    await expect(deletePersonTask({ personId: solo.personId }, jobContext().context)).resolves.toBeUndefined();
    const left = await sql<{ n: string }>`SELECT count(*) AS n FROM people WHERE id = ${solo.personId}::uuid`.execute(owner);
    expect(left.rows[0]?.n).toBe("0");
  });

  it("W2-DEL-T9: a running meeting of the person goes, and a third meeting of the other person is untouched (fake: none; the statement order is not observed)", async () => {
    const s = await freshScenario();
    const third = await seedSide(database.db, "Test C", TURNS_B);
    const pairBC = await createJoinedPair(database.db, s.b.personId, third.personId);
    const thirdMeeting = await createMeeting(database.db, { pairId: pairBC, me: s.b.personId, myCard: s.b.cardId, questionText: "Third question" });
    await deletePersonTask({ personId: s.a.personId }, jobContext().context);

    const untouched = await withPerson(workerDb, s.b.personId, (trx) => trx.selectFrom("meetings").select(["state", "end_reason", "ended_at"]).where("id", "=", thirdMeeting).executeTakeFirstOrThrow());
    expect(untouched).toEqual({ state: "ready", end_reason: null, ended_at: null });
    const gone = await sql<{ n: string }>`SELECT count(*) AS n FROM meetings WHERE id = ${s.meetingId}::uuid`.execute(owner);
    expect(gone.rows[0]?.n).toBe("0");
  });
});

