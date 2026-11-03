import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { makeDatabase, POOL_SIZE } from "./client.js";
import { parseDatabaseError } from "./database-errors.js";
import { asPerson, createPairedMeetingWithTurns, createTestPerson, freshTestDatabase, withNoContext, type SeededMeeting, type TestDatabase } from "./testing/index.js";
import type { Database } from "./types.js";

let t: TestDatabase;
let worker: Kysely<Database>;
// Two invite pairs: x.a and x.b are friends, y.a and y.b are friends.
let x: SeededMeeting;
let y: SeededMeeting;
let listingYb: string;
let listingYa: string;

// Lists one person in Explore with their card, as that person; returns the listing id.
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

// Sends a friend request to a listing as one person with this daily cap; returns the request id.
async function sendRequest(personId: string, listingId: string, cap = 20): Promise<string | undefined> {
  return asPerson(t.db, personId, async (trx) => (await sql<{ id: string }>`SELECT friend_request_send(${listingId}::uuid, ${cap}::int) AS id`.execute(trx)).rows[0]?.id);
}

beforeAll(async () => {
  t = await freshTestDatabase();
  worker = makeDatabase(t.workerUrl, POOL_SIZE.test);
  x = await createPairedMeetingWithTurns(t.db);
  y = await createPairedMeetingWithTurns(t.db);
  listingYb = await list(y.b.personId, y.b.cardId, "Plans the week on Sunday.");
  listingYa = await list(y.a.personId, y.a.cardId, "Likes one clear owner for every task.");
});

afterAll(async () => {
  await worker.destroy();
  await t.drop();
});

describe("friend requests in the database", () => {
  it("W7-DB-T1: a request is visible to its two people only, and app_api cannot write the table itself", async () => {
    const requestId = await sendRequest(x.a.personId, listingYb);
    const seenBy = async (personId: string) => (await asPerson(t.db, personId, (trx) => trx.selectFrom("friend_requests").select("id").execute())).map((row) => row.id);

    expect(await seenBy(x.a.personId)).toEqual([requestId]);
    expect(await seenBy(y.b.personId)).toEqual([requestId]);
    expect(await seenBy(x.b.personId)).toEqual([]);
    const direct = await caught(() => asPerson(t.db, x.b.personId, (trx) => trx.insertInto("friend_requests").values({ from_person_id: x.b.personId, to_person_id: y.b.personId }).execute()));
    expect(Reflect.get(direct ?? {}, "code")).toBe("42501");
    const forged = await caught(() => asPerson(t.db, y.b.personId, (trx) => trx.updateTable("friend_requests").set({ state: "accepted" }).where("id", "=", requestId ?? "").execute()));
    expect(Reflect.get(forged ?? {}, "code")).toBe("42501");
  });

  it("W7-DB-T2: send refuses by code: a request waiting either way, your own listing, and the daily cap", async () => {
    const twice = await caught(() => sendRequest(x.a.personId, listingYb));
    const self = await caught(() => sendRequest(y.b.personId, listingYb));
    const capped = await caught(() => sendRequest(x.a.personId, listingYa, 1));

    expect(parseDatabaseError(twice)?.code).toBe("friend_request_pending");
    expect(parseDatabaseError(self)?.code).toBe("friend_request_self");
    expect(parseDatabaseError(capped)).toEqual({ code: "friend_request_daily_cap", message: "You have sent today's friend requests. Try again tomorrow." });
  });

  it("W7-DB-T3: only the receiver accepts, once; accepting makes friend_list show each to the other, with the listing on the listed side", async () => {
    const requestId = (await asPerson(t.db, y.b.personId, (trx) => trx.selectFrom("friend_requests").select("id").where("state", "=", "pending").executeTakeFirstOrThrow())).id;
    const bySender = await caught(() => asPerson(t.db, x.a.personId, (trx) => sql`SELECT friend_request_accept(${requestId}::uuid)`.execute(trx)));
    const pairId = await asPerson(t.db, y.b.personId, async (trx) => (await sql<{ id: string }>`SELECT friend_request_accept(${requestId}::uuid) AS id`.execute(trx)).rows[0]?.id);
    const again = await caught(() => asPerson(t.db, y.b.personId, (trx) => sql`SELECT friend_request_accept(${requestId}::uuid)`.execute(trx)));
    const friendsOf = (personId: string) => asPerson(t.db, personId, async (trx) => (await sql<{ pair_id: string; display_name: string; listing_id: string | null }>`SELECT pair_id, display_name, listing_id FROM friend_list()`.execute(trx)).rows);

    expect(parseDatabaseError(bySender)?.code).toBe("friend_request_not_found");
    expect(parseDatabaseError(again)?.code).toBe("friend_request_decided");
    expect(await friendsOf(x.a.personId)).toContainEqual({ pair_id: pairId, display_name: "Test B", listing_id: listingYb });
    expect(await friendsOf(y.b.personId)).toContainEqual({ pair_id: pairId, display_name: "Test A", listing_id: null });
    const pair = await asPerson(t.db, y.b.personId, (trx) => trx.selectFrom("pairs").select(["creator_person_id", "joiner_person_id", "via_directory"]).where("id", "=", pairId ?? "").executeTakeFirstOrThrow());
    expect(pair).toEqual({ creator_person_id: x.a.personId, joiner_person_id: y.b.personId, via_directory: false });
    const already = await caught(() => sendRequest(x.a.personId, listingYb));
    expect(parseDatabaseError(already)?.code).toBe("already_friends");
  });

  it("W7-PHOTO-DB-T1: friend_list (migration 0010) carries each friend's sample mark, so the app can show a sample friend's face", async () => {
    const markOf = async (personId: string, displayName: string): Promise<boolean | undefined> => {
      const rows = await asPerson(t.db, personId, async (trx) => (await sql<{ display_name: string; is_sample: boolean }>`SELECT display_name, is_sample FROM friend_list()`.execute(trx)).rows);
      return rows.find((row) => row.display_name === displayName)?.is_sample;
    };
    expect(await markOf(y.a.personId, "Test B")).toBe(false);
    await asPerson(t.db, y.b.personId, (trx) => trx.updateTable("people").set({ is_sample: true }).where("id", "=", y.b.personId).execute());
    try {
      expect(await markOf(y.a.personId, "Test B")).toBe(true);
    } finally {
      await asPerson(t.db, y.b.personId, (trx) => trx.updateTable("people").set({ is_sample: false }).where("id", "=", y.b.personId).execute());
    }
  });

  it("W7-DB-T4: directory_profile answers nothing with no person set, and friend_requests_mine never names a person id", async () => {
    const none = await withNoContext(t.db, async (trx) => (await sql`SELECT * FROM directory_profile(${listingYb}::uuid)`.execute(trx)).rows);
    expect(none).toEqual([]);
    const stranger = await createTestPerson(t.db, "Test C");
    await sendRequest(stranger.personId, listingYa);
    const rows = await asPerson(t.db, y.a.personId, async (trx) => (await sql<Record<string, unknown>>`SELECT * FROM friend_requests_mine()`.execute(trx)).rows);
    expect(rows.map((row) => Object.keys(row).sort())).toEqual([["created_at", "direction", "other_display_name", "other_listing_id", "request_id"]]);
    expect(rows[0]).toMatchObject({ direction: "incoming", other_display_name: "Test C", other_listing_id: null });
  });
});

describe("the orchestrator chat in the database", () => {
  it("W7-DB-T5: a person sees only their own messages, and the worker may read and update them in that person's context but never insert", async () => {
    await asPerson(t.db, x.a.personId, (trx) => trx.insertInto("orchestrator_messages").values({ person_id: x.a.personId, role: "you", text: "hello", state: "done" }).execute());
    const own = await asPerson(t.db, x.a.personId, (trx) => trx.selectFrom("orchestrator_messages").select("text").execute());
    const other = await asPerson(t.db, x.b.personId, (trx) => trx.selectFrom("orchestrator_messages").select("text").execute());
    const forged = await caught(() => asPerson(t.db, x.b.personId, (trx) => trx.insertInto("orchestrator_messages").values({ person_id: x.a.personId, role: "you", text: "not mine", state: "done" }).execute()));
    const workerInsert = await caught(() => asPerson(worker, x.a.personId, (trx) => trx.insertInto("orchestrator_messages").values({ person_id: x.a.personId, role: "you", text: "from the worker", state: "done" }).execute()));
    const workerRead = await asPerson(worker, x.a.personId, (trx) => trx.selectFrom("orchestrator_messages").select("text").execute());

    expect(own.map((row) => row.text)).toEqual(["hello"]);
    expect(other).toEqual([]);
    expect(Reflect.get(forged ?? {}, "code")).toBe("42501");
    expect(Reflect.get(workerInsert ?? {}, "code")).toBe("42501");
    expect(workerRead.map((row) => row.text)).toEqual(["hello"]);
  });
});

describe("the request lists", () => {
  it("W7-CHECK-T6: friend_requests_mine returns at most 100 requests each way, newest first", async () => {
    const listed = await createPairedMeetingWithTurns(t.db);
    const listing = await list(listed.b.personId, listed.b.cardId, "Popular person.");
    for (let index = 0; index < 101; index += 1) {
      const sender = await createTestPerson(t.db, `Sender ${String(index)}`);
      await sendRequest(sender.personId, listing);
    }

    const rows = await asPerson(t.db, listed.b.personId, async (trx) => (await sql<{ direction: string; other_display_name: string }>`SELECT direction, other_display_name FROM friend_requests_mine()`.execute(trx)).rows);

    expect(rows).toHaveLength(100);
    expect(rows.every((row) => row.direction === "incoming")).toBe(true);
    expect(rows[0]?.other_display_name).toBe("Sender 100");
  });
});
