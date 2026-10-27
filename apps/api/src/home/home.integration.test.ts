import { randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOME_CARD_ITEMS_MAX, HOME_LIST_MAX, HomeView, PAIR_LIFETIME_HOURS, PAIR_TOKEN_BYTES, routes } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, withMeeting, type Database } from "@meet-first/db";
import { asPerson, createApprovedCard, createFrozenSource, createPairedMeetingWithTurns, createTestPerson, readTestDatabaseUrls, sha256Text, type SeededMeeting } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/app-factory.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerHomeRoutes } from "./index.js";

let t: Awaited<ReturnType<typeof buildTestApp>>;
let workerDb: Kysely<Database>;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerHomeRoutes] });
  workerDb = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, POOL_SIZE.test);
});

afterAll(async () => {
  await workerDb.destroy();
  await t.close();
});

// Returns the item at index, and throws when the list is shorter.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The list has no item at index ${String(index)}.`);
  return item;
}

// GET /api/home as one person, parsed with the contracts schema.
async function getHome(token: string): Promise<HomeView> {
  const response = await t.app.inject({ method: "GET", url: routes.people.readHome.path, headers: sessionHeader(token) });
  expect(response.statusCode).toBe(200);
  return HomeView.parse(JSON.parse(response.body));
}

// A source that is uploaded but not yet through the names pass or the review, created at the given time.
async function insertOpenSource(personId: string, createdAt: Date): Promise<string> {
  return asPerson(t.db, personId, async (trx) => {
    const row = await trx.insertInto("sources").values({
      person_id: personId, kind: "paste", content_hash: sha256Text(randomBytes(8).toString("hex")), turn_count: 1, canonical_chars: 10,
      persona_signal: "0.500", parser_version: "test", scrub_version: "test", attested_at: createdAt, created_at: createdAt,
    }).returning("id").executeTakeFirstOrThrow();
    return row.id;
  });
}

// A card in the given state on a frozen source, with items whose approved flags follow the list, in positions 1, 2, 3 and on.
async function insertCard(personId: string, input: { sourceId: string; state: "ready" | "approved"; approved: boolean[]; createdAt: Date }): Promise<string> {
  return asPerson(t.db, personId, async (trx) => {
    const turn = await trx.selectFrom("turns").select(["id", "text", "norm_text"]).where("source_id", "=", input.sourceId).orderBy("turn_index").executeTakeFirstOrThrow();
    const card = await trx.insertInto("cards").values({ source_id: input.sourceId, person_id: personId, state: input.state, model: "test-model", prompt_version: "test", items_total: input.approved.length, items_verified: input.approved.length, created_at: input.createdAt }).returning("id").executeTakeFirstOrThrow();
    for (const [index, isApproved] of input.approved.entries()) {
      await trx.insertInto("card_items").values({ card_id: card.id, person_id: personId, position: index + 1, kind: "value", claim: `Claim ${String(index + 1)}`, lang: "en", gloss: "", turn_id: turn.id, quote: turn.text, norm_quote: turn.norm_text, verified: true, flagged: false, approved: isApproved }).execute();
    }
    return card.id;
  });
}

// Another meeting in the seeded pair through meeting_create, made by side a and stamped with the given creation time.
async function addMeeting(seeded: SeededMeeting, createdAt: Date): Promise<string> {
  const result = await sql<{ id: string | null }>`SELECT meeting_create(${seeded.pairId}::uuid, ${seeded.a.personId}::uuid, ${seeded.a.cardId}::uuid, 2, ${"Who decides when we disagree?"}, true) AS id`.execute(t.db);
  const id = result.rows[0]?.id;
  if (id === null || id === undefined) throw new Error("meeting_create returned no id");
  await asPerson(t.db, seeded.a.personId, (trx) => trx.updateTable("meetings").set({ created_at: createdAt }).where("id", "=", id).execute());
  return id;
}

// Writes the brief of one person in a meeting through the worker, as the brief job does.
async function writeBrief(meetingId: string, personId: string): Promise<void> {
  await withMeeting(workerDb, meetingId, (trx) =>
    trx.insertInto("briefs").values({ meeting_id: meetingId, person_id: personId, agree: JSON.stringify([]), clash: JSON.stringify([]), decide_first: JSON.stringify([]), model: "test-model", prompt_version: "v1" }).execute(),
  );
}

// A pair made by this person with the given expiry; returns its id and the invite token.
async function insertPair(personId: string, expiresAt: Date): Promise<{ pairId: string; token: string }> {
  const token = randomBytes(PAIR_TOKEN_BYTES).toString("hex");
  const row = await asPerson(t.db, personId, (trx) => trx.insertInto("pairs").values({ creator_person_id: personId, token_hash: sha256Text(token), expires_at: expiresAt }).returning("id").executeTakeFirstOrThrow());
  return { pairId: row.id, token };
}

describe("GET /api/home", () => {
  it("HOME-T1: a new person gets their name, no source, no card and two empty lists", async () => {
    const person = await createTestPerson(t.db, "Nia");
    const home = await getHome(person.sessionToken);
    expect(home.displayName).toBe("Nia");
    expect(home.source).toBeNull();
    expect(home.card).toBeNull();
    expect(home.meetings).toEqual([]);
    expect(home.pairs).toEqual([]);
    expect(Number.isNaN(Date.parse(home.serverNow))).toBe(false);
  });

  it("HOME-T2: the newest source and the newest card are the ones shown", async () => {
    const person = await createTestPerson(t.db, "Oli");
    const older = await createFrozenSource(t.db, person.personId, ["An older turn that is long enough to quote."]);
    const olderCard = await insertCard(person.personId, { sourceId: older.sourceId, state: "approved", approved: [true], createdAt: new Date(Date.now() - 60_000) });
    const newerCard = await insertCard(person.personId, { sourceId: older.sourceId, state: "ready", approved: [false, false], createdAt: new Date() });
    const frozenHome = await getHome(person.sessionToken);
    expect(frozenHome.source).toEqual({ id: older.sourceId, namesPassDone: true, namesReviewed: true });
    expect(frozenHome.card?.id).toBe(newerCard);
    expect(frozenHome.card?.id).not.toBe(olderCard);
    const newer = await insertOpenSource(person.personId, new Date(Date.now() + 60_000));
    const home = await getHome(person.sessionToken);
    expect(home.source).toEqual({ id: newer, namesPassDone: false, namesReviewed: false });
  });

  it("HOME-T3: an approved card shows its approved items in position order; any other card shows its items in position order; both stop at the cap", async () => {
    const person = await createTestPerson(t.db, "Pia");
    const source = await createFrozenSource(t.db, person.personId, ["A turn that is long enough to be quoted here."]);
    await insertCard(person.personId, { sourceId: source.sourceId, state: "approved", approved: [false, true, false, true, true, true], createdAt: new Date(Date.now() - 60_000) });
    const approvedHome = await getHome(person.sessionToken);
    expect(approvedHome.card?.state).toBe("approved");
    expect(approvedHome.card?.itemCount).toBe(6);
    expect(approvedHome.card?.items.map((item) => item.claim)).toEqual(["Claim 2", "Claim 4", "Claim 5"]);
    expect(approvedHome.card?.items.length).toBe(HOME_CARD_ITEMS_MAX);
    expect(at(approvedHome.card?.items ?? [], 0)).toEqual({ kind: "value", claim: "Claim 2", quote: "A turn that is long enough to be quoted here." });
    await insertCard(person.personId, { sourceId: source.sourceId, state: "ready", approved: [false, false, true, false], createdAt: new Date() });
    const readyHome = await getHome(person.sessionToken);
    expect(readyHome.card?.state).toBe("ready");
    expect(readyHome.card?.itemCount).toBe(4);
    expect(readyHome.card?.items.map((item) => item.claim)).toEqual(["Claim 1", "Claim 2", "Claim 3"]);
  });

  it("HOME-T4: meetings come newest first, at most 10, with deleted ones left out and the other member's name", async () => {
    const seeded = await createPairedMeetingWithTurns(t.db);
    const base = Date.now() - 3_600_000;
    await asPerson(t.db, seeded.a.personId, (trx) => trx.updateTable("meetings").set({ created_at: new Date(base) }).where("id", "=", seeded.meetingId).execute());
    const made: string[] = [];
    for (let index = 1; index <= 11; index += 1) {
      made.push(await addMeeting(seeded, new Date(base + index * 1000)));
    }
    const deleted = at(made, 10);
    await asPerson(t.db, seeded.a.personId, (trx) => trx.updateTable("meetings").set({ state: "deleted" }).where("id", "=", deleted).execute());
    const home = await getHome(seeded.a.sessionToken);
    const expected = made.slice(0, 10).reverse();
    expect(home.meetings.length).toBe(HOME_LIST_MAX);
    expect(home.meetings.map((meeting) => meeting.id)).toEqual(expected);
    expect(home.meetings.map((meeting) => meeting.id)).not.toContain(deleted);
    expect(home.meetings.map((meeting) => meeting.id)).not.toContain(seeded.meetingId);
    expect(home.meetings.every((meeting) => meeting.otherDisplayName === "Test B")).toBe(true);
    const forB = await getHome(seeded.b.sessionToken);
    expect(forB.meetings.every((meeting) => meeting.otherDisplayName === "Test A")).toBe(true);
    expect(at(forB.meetings, 0)).toMatchObject({ questionText: "Who decides when we disagree?", state: "ready" });
  });

  it("HOME-T5: isBriefReady is true only for the side whose brief exists", async () => {
    const seeded = await createPairedMeetingWithTurns(t.db);
    expect(at((await getHome(seeded.a.sessionToken)).meetings, 0).isBriefReady).toBe(false);
    await writeBrief(seeded.meetingId, seeded.a.personId);
    expect(at((await getHome(seeded.a.sessionToken)).meetings, 0).isBriefReady).toBe(true);
    expect(at((await getHome(seeded.b.sessionToken)).meetings, 0).isBriefReady).toBe(false);
  });

  it("HOME-T6: expired pairs are left out, and otherDisplayName is null before a join and the other name after", async () => {
    const maker = await createTestPerson(t.db, "Ray");
    const joiner = await createTestPerson(t.db, "Sol");
    const live = Date.now() + PAIR_LIFETIME_HOURS * 3_600_000;
    const expired = await insertPair(maker.personId, new Date(Date.now() - 60_000));
    const open = await insertPair(maker.personId, new Date(live));
    const before = await getHome(maker.sessionToken);
    expect(before.pairs.map((pair) => pair.id)).toEqual([open.pairId]);
    expect(before.pairs.map((pair) => pair.id)).not.toContain(expired.pairId);
    expect(at(before.pairs, 0).otherDisplayName).toBeNull();
    const joined = await sql<{ pair_id: string | null }>`SELECT pairs_join(${sha256Text(open.token)}, ${joiner.personId}::uuid) AS pair_id`.execute(t.db);
    expect(joined.rows[0]?.pair_id).toBe(open.pairId);
    expect(at((await getHome(maker.sessionToken)).pairs, 0).otherDisplayName).toBe("Sol");
    const forJoiner = await getHome(joiner.sessionToken);
    expect(forJoiner.pairs.map((pair) => pair.id)).toEqual([open.pairId]);
    expect(at(forJoiner.pairs, 0).otherDisplayName).toBe("Ray");
  });

  it("HOME-T7: an approved card from the seed shows up with its state and count", async () => {
    const person = await createTestPerson(t.db, "Uma");
    const source = await createFrozenSource(t.db, person.personId, ["A seeded turn that the card can quote."]);
    const card = await createApprovedCard(t.db, source.sourceId, { items: 2 });
    const home = await getHome(person.sessionToken);
    expect(home.card).toMatchObject({ id: card.cardId, state: "approved", itemCount: 2 });
    expect(home.card?.items.length).toBe(2);
  });
});
