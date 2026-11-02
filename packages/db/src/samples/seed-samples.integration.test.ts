import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { makeDatabase, POOL_SIZE } from "../client.js";
import { asPerson, createApprovedCard, createFrozenSource, createTestPerson, freshTestDatabase, withNoContext, type TestDatabase } from "../testing/index.js";
import type { Database } from "../types.js";
import { SAMPLE_PEOPLE } from "./sample-people.js";
import { seedSamplePeople, type SeedReport } from "./seed-samples.js";

let t: TestDatabase;
let worker: Kysely<Database>;
let first: SeedReport;
let second: SeedReport;
// A real person who browses Explore, and a real person listed there with one post.
let viewer: string;
let listedReal: { personId: string; listingId: string };
const NOW = new Date("2026-11-03T12:00:00Z");

// One page of Explore as one person, by display name, with the sample mark.
async function browse(personId: string, query = ""): Promise<Array<{ display_name: string; is_sample: boolean; items: unknown[] }>> {
  return asPerson(t.db, personId, async (trx) => (await sql<{ display_name: string; is_sample: boolean; items: unknown[] }>`SELECT display_name, is_sample, items FROM directory_browse(${query}, 50, 0)`.execute(trx)).rows);
}

// The listing id of a sample person, as one person's Explore shows it.
async function listingOf(personId: string, displayName: string): Promise<string> {
  const row = await asPerson(t.db, personId, async (trx) => (await sql<{ listing_id: string }>`SELECT listing_id FROM directory_browse('', 50, 0) WHERE display_name = ${displayName}`.execute(trx)).rows[0]);
  if (row === undefined) throw new Error(`${displayName} is not in Explore.`);
  return row.listing_id;
}

beforeAll(async () => {
  t = await freshTestDatabase();
  worker = makeDatabase(t.workerUrl, POOL_SIZE.test);
  viewer = (await createTestPerson(t.db, "Viewer")).personId;
  const real = await createTestPerson(t.db, "Real Person");
  const source = await createFrozenSource(t.db, real.personId, ["I plan the week every Sunday evening with a cup of tea.", "I keep one list and cross things off it by hand."]);
  const card = await createApprovedCard(t.db, source.sourceId, { items: 6 });
  const listing = await asPerson(t.db, real.personId, async (trx) => {
    await trx.insertInto("posts").values({ person_id: real.personId, text: "A post by a real person.", created_at: new Date(NOW.getTime() - 60_000) }).execute();
    return trx.insertInto("directory_listings").values({ person_id: real.personId, card_id: card.cardId, line: "Plans the week on Sunday." }).returning("id").executeTakeFirstOrThrow();
  });
  listedReal = { personId: real.personId, listingId: listing.id };
  first = await seedSamplePeople({ api: t.db, worker }, { now: NOW });
  second = await seedSamplePeople({ api: t.db, worker }, { now: NOW });
});

afterAll(async () => {
  await worker.destroy();
  await t.drop();
});

describe("the sample people seed", () => {
  it("W7-SAMPLE-T4: the first run adds all six, a second run adds none, and Explore lists real people first, then the six marked Sample in the seed's order with four public items each", async () => {
    const names = SAMPLE_PEOPLE.map((person) => person.displayName);
    const page = await browse(viewer);

    expect(first).toEqual({ added: names, present: [], wasBusy: false });
    expect(second).toEqual({ added: [], present: names, wasBusy: false });
    expect(page[0]).toMatchObject({ display_name: "Real Person", is_sample: false });
    expect(page.slice(1).map((row) => row.display_name)).toEqual(names);
    expect(page.slice(1).every((row) => row.is_sample && row.items.length === 4)).toBe(true);
    const samplePeople = await withNoContext(t.db, async (trx) => (await sql<{ display_name: string }>`SELECT display_name FROM sample_people_listed()`.execute(trx)).rows.map((row) => row.display_name));
    expect(samplePeople).toEqual([...names].sort());
  });

  it("W7-SAMPLE-T11: a seed that finds the lock taken adds nothing and does not wait", async () => {
    const report = await t.db.connection().execute(async (holder) => {
      await sql`SELECT pg_advisory_lock(9003011::bigint)`.execute(holder);
      try {
        return await seedSamplePeople({ api: t.db, worker }, { now: NOW });
      } finally {
        await sql`SELECT pg_advisory_unlock(9003011::bigint)`.execute(holder);
      }
    });

    expect(report).toEqual({ added: [], present: [], wasBusy: true });
  });

  it("W7-SAMPLE-T5: search finds a sample person by the words of a public item", async () => {
    const found = await browse(viewer, "bridge rounds");

    expect(found.map((row) => row.display_name)).toEqual(["Maya"]);
  });

  it("W7-SAMPLE-T6: a friend request to a sample person is accepted at once, and their agent can be asked", async () => {
    const listingId = await listingOf(viewer, "Maya");
    const requestId = await asPerson(t.db, viewer, async (trx) => (await sql<{ id: string }>`SELECT friend_request_send(${listingId}::uuid, 20) AS id`.execute(trx)).rows[0]?.id);
    const request = await asPerson(t.db, viewer, (trx) => trx.selectFrom("friend_requests").select(["state", "pair_id"]).where("id", "=", requestId ?? "").executeTakeFirstOrThrow());
    const profile = await asPerson(t.db, viewer, async (trx) => (await sql<{ friendship: string; pair_id: string | null; can_ask: boolean; is_sample: boolean }>`SELECT friendship, pair_id, can_ask, is_sample FROM directory_profile(${listingId}::uuid)`.execute(trx)).rows[0]);
    const friends = await asPerson(t.db, viewer, async (trx) => (await sql<{ display_name: string; can_ask: boolean }>`SELECT display_name, can_ask FROM friend_list()`.execute(trx)).rows);

    expect(request.state).toBe("accepted");
    expect(profile).toEqual({ friendship: "friends", pair_id: request.pair_id, can_ask: true, is_sample: true });
    expect(friends).toEqual([{ display_name: "Maya", can_ask: true }]);
  });

  it("W7-SAMPLE-T7: a request to a real person still waits for them", async () => {
    const requestId = await asPerson(t.db, viewer, async (trx) => (await sql<{ id: string }>`SELECT friend_request_send(${listedReal.listingId}::uuid, 20) AS id`.execute(trx)).rows[0]?.id);
    const request = await asPerson(t.db, viewer, (trx) => trx.selectFrom("friend_requests").select(["state", "pair_id"]).where("id", "=", requestId ?? "").executeTakeFirstOrThrow());

    expect(request).toEqual({ state: "pending", pair_id: null });
  });
});

describe("posts", () => {
  it("W7-SAMPLE-T8: explore_posts shows the newest posts of listed people, leaving out your own, and never a person id", async () => {
    const rows = await asPerson(t.db, viewer, async (trx) => (await sql<Record<string, unknown>>`SELECT * FROM explore_posts(30)`.execute(trx)).rows);
    const own = await asPerson(t.db, listedReal.personId, async (trx) => (await sql<{ display_name: string }>`SELECT display_name FROM explore_posts(30)`.execute(trx)).rows);
    const postCount = SAMPLE_PEOPLE.reduce((sum, person) => sum + person.posts.length, 0);

    expect(rows).toHaveLength(postCount + 1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["created_at", "display_name", "is_sample", "listing_id", "post_id", "text"]);
    expect(rows[0]).toMatchObject({ display_name: "Real Person", is_sample: false, text: "A post by a real person." });
    expect(rows[1]).toMatchObject({ display_name: "Jun", is_sample: true });
    const times = rows.map((row) => (row.created_at as Date).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(own.some((row) => row.display_name === "Real Person")).toBe(false);
  });

  it("W7-SAMPLE-T9: listing_posts shows one listed person's posts, and nothing without a person set", async () => {
    const listingId = await listingOf(viewer, "Tomas");
    const rows = await asPerson(t.db, viewer, async (trx) => (await sql<{ display_name: string; text: string }>`SELECT display_name, text FROM listing_posts(${listingId}::uuid, 50)`.execute(trx)).rows);
    const none = await withNoContext(t.db, async (trx) => (await sql`SELECT * FROM listing_posts(${listingId}::uuid, 50)`.execute(trx)).rows);
    const tomas = SAMPLE_PEOPLE.find((person) => person.displayName === "Tomas");

    expect(rows).toEqual([...(tomas?.posts ?? [])].sort((a, b) => a.hoursAgo - b.hoursAgo).map((post) => ({ display_name: "Tomas", text: post.text })));
    expect(none).toEqual([]);
  });

  it("W7-SAMPLE-T10: the posts table shows a person only their own posts", async () => {
    const seen = await asPerson(t.db, viewer, (trx) => trx.selectFrom("posts").select("text").execute());
    const mine = await asPerson(t.db, listedReal.personId, (trx) => trx.selectFrom("posts").select("text").execute());

    expect(seen).toEqual([]);
    expect(mine).toEqual([{ text: "A post by a real person." }]);
  });
});
