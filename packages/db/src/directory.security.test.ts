import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { makeDatabase, POOL_SIZE } from "./client.js";
import { parseDatabaseError } from "./database-errors.js";
import { asPerson, createApprovedCard, createFrozenSource, createPairedMeetingWithTurns, createTestPerson, freshTestDatabase, SEED_TURNS_A, type SeededMeeting, type TestDatabase } from "./testing/index.js";
import type { Database } from "./types.js";

let t: TestDatabase;
let worker: Kysely<Database>;
let pair: SeededMeeting;
let carol: { personId: string; cardId: string };

// Marks the items at these positions of one card public, as their owner.
async function markPublic(personId: string, cardId: string, positions: number[]): Promise<void> {
  await asPerson(t.db, personId, (trx) => trx.updateTable("card_items").set({ is_public: true }).where("card_id", "=", cardId).where("position", "in", positions).execute());
}

// Lists one person in the directory with one card, as that person; returns the listing id.
async function list(personId: string, cardId: string, line: string): Promise<string> {
  const row = await asPerson(t.db, personId, (trx) => trx.insertInto("directory_listings").values({ person_id: personId, card_id: cardId, line }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

// The error a statement raises, or undefined when it succeeds.
async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}

// Starts a meeting with a listed persona as this person, with a cap; returns the meeting id.
async function meetListing(me: { personId: string; cardId: string }, listingId: string, cap: number): Promise<string | null> {
  const result = await asPerson(t.db, me.personId, (trx) => sql<{ id: string | null }>`SELECT directory_meeting_create(${listingId}::uuid, ${me.personId}::uuid, ${me.cardId}::uuid, 1, ${"Would we enjoy a 10-day hackathon together?"}, true, ${cap}) AS id`.execute(trx));
  return result.rows[0]?.id ?? null;
}

beforeAll(async () => {
  t = await freshTestDatabase();
  worker = makeDatabase(t.workerUrl, POOL_SIZE.test);
  pair = await createPairedMeetingWithTurns(t.db);
  const person = await createTestPerson(t.db, "Test C");
  const source = await createFrozenSource(t.db, person.personId, [...SEED_TURNS_A]);
  const card = await createApprovedCard(t.db, source.sourceId);
  carol = { personId: person.personId, cardId: card.cardId };
  await markPublic(pair.b.personId, pair.b.cardId, [1]);
  await markPublic(carol.personId, carol.cardId, [1, 2]);
});

afterAll(async () => {
  await worker.destroy();
  await t.drop();
});

describe("directory and asks", () => {
  it("W5-DIR-T1: a listing row is visible only to its owner", async () => {
    await list(carol.personId, carol.cardId, "I build data tools and like long walks.");
    expect(await asPerson(t.db, pair.a.personId, (trx) => trx.selectFrom("directory_listings").select("id").execute())).toHaveLength(0);
    expect(await asPerson(t.db, carol.personId, (trx) => trx.selectFrom("directory_listings").select("id").execute())).toHaveLength(1);
  });

  it("W5-DIR-T2: directory_browse returns listing fields and public items only, and never the caller's own listing", async () => {
    await list(pair.b.personId, pair.b.cardId, "Happy to talk about planning.");
    const seenByA = await asPerson(t.db, pair.a.personId, (trx) => sql<Record<string, unknown>>`SELECT * FROM directory_browse(${""}, 20, 0)`.execute(trx));
    const listingB = seenByA.rows.find((row) => row.display_name === "Test B");
    expect(Object.keys(listingB ?? {}).sort()).toEqual(["display_name", "items", "line", "listing_id"]);
    const items = listingB?.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(["claim", "kind", "quote"]);
    const seenByB = await asPerson(t.db, pair.b.personId, (trx) => sql<{ display_name: string }>`SELECT display_name FROM directory_browse(${""}, 20, 0)`.execute(trx));
    expect(seenByB.rows.map((row) => row.display_name)).toEqual(["Test C"]);
  });

  it("W5-DIR-T3: only an approved, verified item can be public", async () => {
    const error = await caught(() => asPerson(t.db, carol.personId, (trx) => trx.updateTable("card_items").set({ approved: false }).where("card_id", "=", carol.cardId).where("position", "=", 1).execute()));
    expect(Reflect.get(error ?? {}, "code")).toBe("23514");
  });

  it("W5-DIR-T4: directory_meeting_create gives both sides their go-ahead, marks the listed side public-only, refuses one's own or a missing listing, and caps meetings a day", async () => {
    const listingId = await asPerson(t.db, carol.personId, (trx) => trx.selectFrom("directory_listings").select("id").executeTakeFirstOrThrow());
    const meetingId = await meetListing(pair.a, listingId.id, 1);
    if (meetingId === null) throw new Error("no meeting");
    const members = await asPerson(t.db, pair.a.personId, (trx) => sql<{ side: string; ready: boolean; public_only: boolean }>`SELECT side, ready_at IS NOT NULL AS ready, public_only FROM meeting_members WHERE meeting_id = ${meetingId}::uuid ORDER BY side`.execute(trx));
    expect(members.rows).toEqual([{ side: "a", ready: true, public_only: false }, { side: "b", ready: true, public_only: true }]);
    const viaDirectory = await asPerson(t.db, pair.a.personId, (trx) => sql<{ via_directory: boolean }>`SELECT p.via_directory FROM pairs p JOIN meetings m ON m.pair_id = p.id WHERE m.id = ${meetingId}::uuid`.execute(trx));
    expect(viaDirectory.rows[0]?.via_directory).toBe(true);
    expect(parseDatabaseError(await caught(() => meetListing(pair.a, listingId.id, 1)))?.code).toBe("directory_daily_cap");
    expect(parseDatabaseError(await caught(() => meetListing(carol, listingId.id, 10)))?.code).toBe("directory_self");
    expect(parseDatabaseError(await caught(() => meetListing(pair.a, "00000000-0000-4000-8000-000000000999", 10)))?.code).toBe("listing_not_found");
  });

  it("W5-DIR-T5: the help shortlist matches public items of listed people and leaves out the asker", async () => {
    const result = await worker.transaction().execute((trx) => sql<{ display_name: string; match_rank: number }>`SELECT display_name, match_rank FROM directory_shortlist(${["test", "claim"]}::text[], ${carol.personId}::uuid, 20)`.execute(trx));
    expect(result.rows).toEqual([{ display_name: "Test B", match_rank: 1 }]);
    const none = await worker.transaction().execute((trx) => sql<{ n: string }>`SELECT count(*) AS n FROM directory_shortlist(${[]}::text[], ${carol.personId}::uuid, 20)`.execute(trx));
    expect(none.rows[0]?.n).toBe("0");
  });

  it("W5-DIR-T6: friend_list names each invite friend once with their ask switch, and never a directory pair", async () => {
    const before = await asPerson(t.db, pair.a.personId, (trx) => sql<{ display_name: string; can_ask: boolean }>`SELECT display_name, can_ask FROM friend_list()`.execute(trx));
    expect(before.rows).toEqual([{ display_name: "Test B", can_ask: false }]);
    await asPerson(t.db, pair.b.personId, (trx) => trx.updateTable("cards").set({ friends_can_ask: true }).where("id", "=", pair.b.cardId).execute());
    const after = await asPerson(t.db, pair.a.personId, (trx) => sql<{ display_name: string; can_ask: boolean }>`SELECT display_name, can_ask FROM friend_list()`.execute(trx));
    expect(after.rows).toEqual([{ display_name: "Test B", can_ask: true }]);
  });

  it("W5-DIR-T7: a persona answer is visible to its asker and its subject only, and the subject cannot change it", async () => {
    const askerId = pair.a.personId;
    const ask = await asPerson(t.db, askerId, (trx) => trx.insertInto("persona_asks").values({ person_id: askerId, mode: "help", text: "My training loss is flat." }).returning("id").executeTakeFirstOrThrow());
    await asPerson(t.db, askerId, (trx) => trx.insertInto("persona_answers").values({ ask_id: ask.id, asker_person_id: askerId, subject_person_id: pair.b.personId, subject_card_id: pair.b.cardId, mode: "help", ask_text: "My training loss is flat.", asker_display_name: "Test A", subject_display_name: "Test B", shortlist_rank: 1 }).execute());
    expect(await asPerson(t.db, pair.b.personId, (trx) => trx.selectFrom("persona_answers").select("id").execute())).toHaveLength(1);
    const changed = await asPerson(t.db, pair.b.personId, (trx) => trx.updateTable("persona_answers").set({ answer: "changed" }).executeTakeFirst());
    expect(changed.numUpdatedRows).toBe(0n);
    expect(await asPerson(t.db, carol.personId, (trx) => trx.selectFrom("persona_answers").select("id").execute())).toHaveLength(0);
    expect(await asPerson(t.db, pair.b.personId, (trx) => trx.selectFrom("persona_asks").select("id").execute())).toHaveLength(0);
  });
});
