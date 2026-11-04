import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchRecallCorpus } from "./recall-search.js";
import {
  asMeeting,
  asPerson,
  countVisibleRows,
  createApprovedCard,
  createFrozenSource,
  createPairedMeetingWithTurns,
  createTestPerson,
  freshTestDatabase,
  SEED_TURNS_A,
  type SeededMeeting,
  type TestDatabase,
} from "./testing/index.js";
import type { Kysely } from "kysely";
import type { Database } from "./types.js";

let t: TestDatabase;
let m: SeededMeeting;

// Returns the item at index, and throws when the list is shorter.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The list has no item at index ${String(index)}.`);
  return item;
}

// The recall lookup as the card's owner, with the limit the spec fixes.
function searchAsOwner(
  db: Kysely<Database>,
  owner: { personId: string; cardId: string },
  query: string,
) {
  return asPerson(db, owner.personId, (trx) =>
    searchRecallCorpus(trx, { cardId: owner.cardId, query, limit: 5 }),
  );
}

beforeAll(async () => {
  t = await freshTestDatabase();
  m = await createPairedMeetingWithTurns(t.db);
});

afterAll(async () => {
  await t.drop();
});

describe("recall search", () => {
  it("D38-T1: a full-text match returns the matching turn", async () => {
    const rows = await searchAsOwner(
      t.db,
      { personId: m.a.personId, cardId: m.a.cardId },
      "deadlines team",
    );

    expect(rows).toEqual([{ turnId: at(m.a.turnIds, 1), text: at(SEED_TURNS_A, 1) }]);
  });

  it("D38-T2: turns sharing more query words come first", async () => {
    const rows = await searchAsOwner(
      t.db,
      { personId: m.a.personId, cardId: m.a.cardId },
      "plan meeting phone",
    );

    expect(rows).toEqual([
      { turnId: at(m.a.turnIds, 0), text: at(SEED_TURNS_A, 0) },
      { turnId: at(m.a.turnIds, 2), text: at(SEED_TURNS_A, 2) },
    ]);
  });

  it("D38-T3: a near spelling falls back to the trigram step", async () => {
    const rows = await searchAsOwner(
      t.db,
      { personId: m.a.personId, cardId: m.a.cardId },
      "deadlnes",
    );

    expect(rows).toEqual([{ turnId: at(m.a.turnIds, 1), text: at(SEED_TURNS_A, 1) }]);
  });

  it("D38-T4: at most five turns come back, each cut to 600 units", async () => {
    const c = await createTestPerson(t.db, "Test C");
    const source = await createFrozenSource(
      t.db,
      c.personId,
      Array.from({ length: 7 }, () => `budget ${"x".repeat(693)}`),
    );
    const card = await createApprovedCard(t.db, source.sourceId, { recallAllowed: true });

    const rows = await searchAsOwner(t.db, { personId: c.personId, cardId: card.cardId }, "budget");

    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.text.length === 600)).toBe(true);
    expect(rows.every((row) => source.turnIds.includes(row.turnId))).toBe(true);
  });

  it("D38-T5: a query with no words runs no search", async () => {
    const rows = await searchAsOwner(t.db, { personId: m.a.personId, cardId: m.a.cardId }, "?!");

    expect(rows).toEqual([]);
  });

  it("D38-T6: the cut never ends inside a surrogate pair", async () => {
    const d = await createTestPerson(t.db, "Test D");
    const source = await createFrozenSource(t.db, d.personId, [
      `budget ${"x".repeat(592)}\u{1F600}${"y".repeat(10)}`,
    ]);
    const card = await createApprovedCard(t.db, source.sourceId, { recallAllowed: true });

    const rows = await searchAsOwner(t.db, { personId: d.personId, cardId: card.cardId }, "budget");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe(`budget ${"x".repeat(592)}`);
    expect(rows[0]?.text.length).toBe(599);
  });

  it("D38-T7: turns that rank the same come back in their order in the file", async () => {
    const d = await createTestPerson(t.db, "Test D");
    const source = await createFrozenSource(
      t.db,
      d.personId,
      [0, 1, 2, 3, 4, 5, 6].map((index) => `budget note ${String(index)}`),
    );
    const card = await createApprovedCard(t.db, source.sourceId, { recallAllowed: true });

    const fullText = await searchAsOwner(
      t.db,
      { personId: d.personId, cardId: card.cardId },
      "budget",
    );
    const trigram = await searchAsOwner(
      t.db,
      { personId: d.personId, cardId: card.cardId },
      "budgt",
    );

    expect(fullText.map((row) => row.turnId)).toEqual(source.turnIds.slice(0, 5));
    expect(trigram.map((row) => row.turnId)).toEqual(source.turnIds.slice(0, 5));
  });

  it("INV16-T1: a card with recall off yields nothing", async () => {
    const result = await asPerson(t.db, m.b.personId, async (trx) => ({
      rows: await searchRecallCorpus(trx, { cardId: m.b.cardId, query: "deadlines", limit: 5 }),
      visible: await countVisibleRows(trx, "recall_corpus"),
    }));

    expect(result).toEqual({ rows: [], visible: 0 });
  });

  it("INV16-T2: a sensitive turn stays out until its category is opted in", async () => {
    const e = await createTestPerson(t.db, "Test E");
    const source = await createFrozenSource(t.db, e.personId, [
      "My doctor said the migraines come from stress at work.",
      "I keep a calendar for every family visit.",
    ]);
    const card = await createApprovedCard(t.db, source.sourceId, { recallAllowed: true });
    await asPerson(t.db, e.personId, (trx) =>
      trx
        .updateTable("turns")
        .set({ sensitive_categories: ["health"] })
        .where("id", "=", at(source.turnIds, 0))
        .execute(),
    );

    const before = await searchAsOwner(
      t.db,
      { personId: e.personId, cardId: card.cardId },
      "migraines doctor",
    );
    await asPerson(t.db, e.personId, (trx) =>
      trx
        .updateTable("sources")
        .set({ sensitive_opt_in: ["health"] })
        .where("id", "=", source.sourceId)
        .execute(),
    );
    const after = await searchAsOwner(
      t.db,
      { personId: e.personId, cardId: card.cardId },
      "migraines doctor",
    );

    expect(before).toEqual([]);
    expect(after).toEqual([
      {
        turnId: at(source.turnIds, 0),
        text: "My doctor said the migraines come from stress at work.",
      },
    ]);
  });

  it("INV16-T3: a meeting job reads the speaking side's corpus and no other", async () => {
    const found = await asMeeting(t.db, m.meetingId, async (trx) => ({
      a: await searchRecallCorpus(trx, { cardId: m.a.cardId, query: "deadlines team", limit: 5 }),
      b: await searchRecallCorpus(trx, { cardId: m.b.cardId, query: "deadlines", limit: 5 }),
    }));

    expect(found).toEqual({
      a: [{ turnId: at(m.a.turnIds, 1), text: at(SEED_TURNS_A, 1) }],
      b: [],
    });
  });

  it("INV16-T4: a person cannot search another person's corpus", async () => {
    const rows = await asPerson(t.db, m.b.personId, (trx) =>
      searchRecallCorpus(trx, { cardId: m.a.cardId, query: "deadlines team", limit: 5 }),
    );

    expect(rows).toEqual([]);
  });
});
