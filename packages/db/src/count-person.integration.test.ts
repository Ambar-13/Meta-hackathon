import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDatabase, numberFromPostgres } from "./client.js";
import { countRowsForPerson, formatCounts, listPersonColumns } from "./count-person.js";
import { asMeeting, asPerson, countVisibleRows, createPairedMeetingWithTurns, freshTestDatabase, type SeededMeeting, type TestDatabase } from "./testing/index.js";
import { withPerson } from "./transaction.js";
import { sql, type Kysely } from "kysely";
import type { Database } from "./types.js";

let t: TestDatabase;
let worker: Kysely<Database>;
let m: SeededMeeting;

// The row counts a fully deleted person must show: every key of the count, at zero.
const ZERO_COUNTS = { people: 0, briefs: 0, card_items: 0, cards: 0, claims: 0, comics: 0, ledger: 0, meeting_members: 0, names_passes: 0, pairs: 0, quiz_items: 0, quizzes: 0, redactions: 0, sessions: 0, source_names: 0, sources: 0, transfer_links: 0, turns: 0 };

beforeAll(async () => {
  t = await freshTestDatabase();
  worker = makeDatabase(t.workerUrl, 1);
  m = await createPairedMeetingWithTurns(t.db);
});

afterAll(async () => {
  await worker.destroy();
  await t.drop();
});

describe("count person", () => {
  it("D69-T1: the person columns are people by id and every foreign key to people", async () => {
    const entries = await asPerson(t.db, m.a.personId, (trx) => listPersonColumns(trx));

    expect(entries).toEqual([
      { table: "people", columns: ["id"] }, { table: "briefs", columns: ["person_id"] }, { table: "card_items", columns: ["person_id"] },
      { table: "cards", columns: ["person_id"] }, { table: "claims", columns: ["person_id"] }, { table: "comics", columns: ["requested_by"] },
      { table: "ledger", columns: ["person_id"] }, { table: "meeting_members", columns: ["person_id"] }, { table: "names_passes", columns: ["person_id"] },
      { table: "pairs", columns: ["creator_person_id", "joiner_person_id"] }, { table: "quiz_items", columns: ["person_id"] }, { table: "quizzes", columns: ["person_id"] },
      { table: "redactions", columns: ["person_id"] }, { table: "sessions", columns: ["person_id"] }, { table: "source_names", columns: ["person_id"] },
      { table: "sources", columns: ["person_id"] }, { table: "transfer_links", columns: ["person_id"] }, { table: "turns", columns: ["person_id"] },
    ]);
  });

  it("D69-T2: counts a seeded person's rows table by table", async () => {
    const counts = await countRowsForPerson(t.db, m.a.personId);

    expect(counts).toEqual({ people: 1, briefs: 0, card_items: 6, cards: 1, claims: 0, comics: 0, ledger: 0, meeting_members: 1, names_passes: 1, pairs: 1, quiz_items: 0, quizzes: 0, redactions: 0, sessions: 1, source_names: 0, sources: 1, transfer_links: 0, turns: 3 });
    expect(Object.keys(counts)).toEqual(["people", "briefs", "card_items", "cards", "claims", "comics", "ledger", "meeting_members", "names_passes", "pairs", "quiz_items", "quizzes", "redactions", "sessions", "source_names", "sources", "transfer_links", "turns"]);
  });

  it("D69-T3: formatCounts prints one line per table and exits 1 while rows remain", async () => {
    const counts = await countRowsForPerson(t.db, m.a.personId);
    const full = formatCounts(counts);
    const empty = formatCounts({ people: 0 });
    const lines = full.text.split("\n");

    expect(lines).toHaveLength(19);
    expect(lines[0]).toBe(`${"people".padEnd(20)}1`);
    expect(lines[18]).toBe(`${"total".padEnd(20)}16`);
    expect(full.exitCode).toBe(1);
    expect(empty.text).toBe(`${"people".padEnd(20)}0\n${"total".padEnd(20)}0`);
    expect(empty.exitCode).toBe(0);
  });

  it("D69-T4: once the person row is gone every count is 0 and the ledger row stays without a person", async () => {
    const own = await createPairedMeetingWithTurns(t.db);
    await withPerson(worker, own.a.personId, (trx) => trx.insertInto("ledger").values({ person_id: own.a.personId, call_site: "card", model: "test-model", effort: "medium", est_tokens: 100, status: "started", llm_mode: "replay" }).execute());
    const deleted = await asPerson(t.db, own.a.personId, (trx) => trx.deleteFrom("people").where("id", "=", own.a.personId).execute());
    const counts = await countRowsForPerson(t.db, own.a.personId);
    const window = await sql<{ call_count: string; sum_est_tokens: string }>`SELECT * FROM ledger_window(3600)`.execute(worker);

    expect(deleted.map((row) => row.numDeletedRows)).toEqual([1n]);
    expect(counts).toEqual(ZERO_COUNTS);
    expect(numberFromPostgres(window.rows[0]?.call_count)).toBe(1);
    expect(numberFromPostgres(window.rows[0]?.sum_est_tokens)).toBe(100);
  });

  it("R9.6-T1: a person can be deleted while their meeting runs", async () => {
    const own = await createPairedMeetingWithTurns(t.db);
    await asMeeting(t.db, own.meetingId, async (trx) => {
      await trx.updateTable("meetings").set({ state: "running" }).where("id", "=", own.meetingId).execute();
      await trx.insertInto("meeting_steps").values({ meeting_id: own.meetingId, step_seq: 1, side: "a", phase: "open", state: "running", claimed_at: new Date() }).execute();
    });
    const deleted = await asPerson(t.db, own.a.personId, (trx) => trx.deleteFrom("people").where("id", "=", own.a.personId).execute());
    const seen = await asPerson(t.db, own.b.personId, async (trx) => ({
      meetings: await countVisibleRows(trx, "meetings"),
      members: await countVisibleRows(trx, "meeting_members"),
      steps: await countVisibleRows(trx, "meeting_steps"),
    }));

    expect(deleted.map((row) => row.numDeletedRows)).toEqual([1n]);
    expect(seen).toEqual({ meetings: 0, members: 0, steps: 0 });
  });

  it("R9.7-T1: the other member keeps their source and card and loses the joint rows", async () => {
    const own = await createPairedMeetingWithTurns(t.db);
    await asPerson(t.db, own.a.personId, (trx) => trx.deleteFrom("people").where("id", "=", own.a.personId).execute());
    const counts = await countRowsForPerson(t.db, own.b.personId);

    expect(counts).toEqual({ people: 1, briefs: 0, card_items: 6, cards: 1, claims: 0, comics: 0, ledger: 0, meeting_members: 0, names_passes: 1, pairs: 0, quiz_items: 0, quizzes: 0, redactions: 0, sessions: 1, source_names: 0, sources: 1, transfer_links: 0, turns: 3 });
  });
});
