import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DirectoryPage, FriendsView, routes } from "@meet-first/contracts";
import { asPerson, createApprovedCard, createFrozenSource, createPairedMeeting, createTestPerson } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { TEST_APP_ORIGIN } from "../testing/app-factory.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerDirectoryRoutes } from "./index.js";

// The three turns every seeded person uploads. createApprovedCard quotes them in turn, so items 1 and 4 quote the first, 2 and 5 the second, 3 and 6 the third.
const TURNS = ["I plan the week on Sunday night and keep to it.", "I answer messages only after lunch.", "Honest feedback matters more to me than comfort."];

// A seeded person: a session, a frozen source of TURNS, and an approved card whose items are all approved and verified.
type Member = { personId: string; sessionToken: string; cardId: string; itemIds: string[]; turnIds: string[] };

let t: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerDirectoryRoutes] });
});

afterAll(async () => {
  await t.close();
});

// Makes one person with a frozen source of TURNS and an approved card of this many items (6 unless given).
async function seedMember(displayName: string, items = 6): Promise<Member> {
  const person = await createTestPerson(t.db, displayName);
  const source = await createFrozenSource(t.db, person.personId, [...TURNS]);
  const card = await createApprovedCard(t.db, source.sourceId, { items });
  return { personId: person.personId, sessionToken: person.sessionToken, cardId: card.cardId, itemIds: card.itemIds, turnIds: source.turnIds };
}

// Sends one request through the test app as this person, or with no session when null, always with the app's Origin, and with a JSON body when one is given.
function send(member: { sessionToken: string } | null, call: { method: "GET" | "PUT" | "POST" | "DELETE"; url: string; payload?: unknown }) {
  const headers: Record<string, string> = member === null ? { origin: TEST_APP_ORIGIN } : sessionHeader(member.sessionToken);
  if (call.payload !== undefined) headers["content-type"] = "application/json";
  return t.app.inject({ method: call.method, url: call.url, headers, ...(call.payload === undefined ? {} : { payload: JSON.stringify(call.payload) }) });
}

// The URL of a route with its :id filled in.
function pathOf(route: { path: string }, id: string): string {
  return route.path.replace(":id", id);
}

// Marks these positions of a card public, as its owner (the person's first card unless another card id is given).
async function markPublic(member: Member, positions: number[], cardId = member.cardId): Promise<void> {
  await asPerson(t.db, member.personId, (trx) => trx.updateTable("card_items").set({ is_public: true }).where("card_id", "=", cardId).where("position", "in", positions).execute());
}

// Lists the person in the directory with their first card and this line, as that person; returns the listing id.
async function listMember(member: Member, line: string, isOpenToRomance = false): Promise<string> {
  const row = await asPerson(t.db, member.personId, (trx) => trx.insertInto("directory_listings").values({ person_id: member.personId, card_id: member.cardId, line, open_to_romance: isOpenToRomance }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

// Waits this many milliseconds, so rows made one after the other get created_at values in that order.
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// One listed person of this file.
type Lister = { member: Member; listingId: string };

// The 21 listed people of this file, oldest first: Lister 01 to Lister 21. Lister 07's line holds the word Postgres; Lister 21 is open to dating questions.
const listers: Lister[] = [];
let viewer: Member;

beforeAll(async () => {
  viewer = await seedMember("Zed Viewer", 1);
  for (let n = 1; n <= 21; n += 1) {
    const member = await seedMember("Lister " + String(n).padStart(2, "0"), 1);
    await markPublic(member, [1]);
    listers.push({ member, listingId: await listMember(member, n === 7 ? "I fix flaky Postgres tests." : "Line " + String(n), n === 21) });
    await pause(10);
  }
});

// Lister number n, from 1 to 21.
function lister(n: number): Lister {
  const found = listers[n - 1];
  if (found === undefined) throw new Error("no lister " + String(n));
  return found;
}

describe("directory and friends routes", () => {
  it("W6-DAPI-T24 (design sections 6 and 10, P6, P8): the first page shows the 20 newest listings with listing fields, the dating switch and public items only, and says a next page exists", async () => {
    const response = await send(viewer, { method: "GET", url: routes.directory.browse.path });
    const page = DirectoryPage.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(page.page).toBe(0);
    expect(page.hasMore).toBe(true);
    expect(page.listings.map((listing) => listing.displayName)).toEqual(["Lister 21", "Lister 20", "Lister 19", "Lister 18", "Lister 17", "Lister 16", "Lister 15", "Lister 14", "Lister 13", "Lister 12", "Lister 11", "Lister 10", "Lister 09", "Lister 08", "Lister 07", "Lister 06", "Lister 05", "Lister 04", "Lister 03", "Lister 02"]);
    expect(page.listings[0]).toEqual({ listingId: lister(21).listingId, displayName: "Lister 21", line: "Line 21", openToRomance: true, isSample: false, items: [{ kind: "value", claim: "Test claim 1", quote: "I plan the week on Sunday night and keep to it." }], photo: null });
    expect(page.listings.filter((listing) => listing.openToRomance)).toHaveLength(1);
    for (const word of ['"personId"', '"cardId"', '"person_id"', '"card_id"', '"turnId"', '"turn_id"', '"itemId"', '"position"']) {
      expect(response.body).not.toContain(word);
    }
  });

  it("W6-DAPI-T25 (design section 6): the second page holds the oldest listing and says no page follows", async () => {
    const response = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?page=1" });
    const page = DirectoryPage.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(page.page).toBe(1);
    expect(page.hasMore).toBe(false);
    expect(page.listings.map((listing) => listing.displayName)).toEqual(["Lister 01"]);
  });

  it("W6-DAPI-T26 (design section 6, P6): a listed person never sees their own listing", async () => {
    const response = await send(lister(21).member, { method: "GET", url: routes.directory.browse.path });
    const page = DirectoryPage.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(page.hasMore).toBe(false);
    expect(page.listings.map((listing) => listing.displayName)).toEqual(["Lister 20", "Lister 19", "Lister 18", "Lister 17", "Lister 16", "Lister 15", "Lister 14", "Lister 13", "Lister 12", "Lister 11", "Lister 10", "Lister 09", "Lister 08", "Lister 07", "Lister 06", "Lister 05", "Lister 04", "Lister 03", "Lister 02", "Lister 01"]);
  });

  it("W6-DAPI-T27 (design section 6): search words find the listing whose line holds them", async () => {
    const plain = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?query=postgres" });
    const padded = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?query=%20%20Postgres%20%20" });
    const missing = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?query=zebra" });

    expect(plain.statusCode).toBe(200);
    expect(DirectoryPage.parse(plain.json())).toEqual({ listings: [{ listingId: lister(7).listingId, displayName: "Lister 07", line: "I fix flaky Postgres tests.", openToRomance: false, isSample: false, items: [{ kind: "value", claim: "Test claim 1", quote: "I plan the week on Sunday night and keep to it." }], photo: null }], page: 0, hasMore: false });
    expect(padded.statusCode).toBe(200);
    expect(DirectoryPage.parse(padded.json()).listings.map((listing) => listing.displayName)).toEqual(["Lister 07"]);
    expect(DirectoryPage.parse(padded.json()).hasMore).toBe(false);
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toEqual({ listings: [], page: 0, hasMore: false });
  });

  it("W6-DAPI-T28 (design section 6): a query string DirectoryQuery refuses is 400 payload_invalid, and a page past 100000 answers empty", async () => {
    const negative = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?page=-1" });
    const text = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?page=abc" });
    const long = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?query=" + "a".repeat(201) });
    const beyond = await send(viewer, { method: "GET", url: routes.directory.browse.path + "?page=100001" });

    const refusal = { code: "payload_invalid", message: "The request body did not match the expected shape. Reload and try again." };
    expect(negative.statusCode).toBe(400);
    expect(negative.json()).toEqual(refusal);
    expect(text.statusCode).toBe(400);
    expect(text.json()).toEqual(refusal);
    expect(long.statusCode).toBe(400);
    expect(long.json()).toEqual(refusal);
    expect(beyond.statusCode).toBe(200);
    expect(beyond.json()).toEqual({ listings: [], page: 100001, hasMore: false });
  });

  it("W6-DAPI-T29 (design section 6, P3): friends are the invite pair partners with their own ask switch, and a directory meeting adds none", async () => {
    const m = await createPairedMeeting(t.db);
    const sharing = await send(m.b, { method: "PUT", url: pathOf(routes.directory.updateSharing, m.b.cardId), payload: { friendsCanAsk: true, publicPositions: [] } });
    const meeting = await send(m.a, { method: "POST", url: pathOf(routes.directory.createListingMeeting, lister(5).listingId), payload: { questionId: 13, cardId: m.a.cardId } });

    const aView = await send(m.a, { method: "GET", url: routes.directory.friends.path });
    const bView = await send(m.b, { method: "GET", url: routes.directory.friends.path });
    const listerView = await send(lister(5).member, { method: "GET", url: routes.directory.friends.path });

    expect(sharing.statusCode).toBe(200);
    expect(meeting.statusCode).toBe(201);
    expect(aView.statusCode).toBe(200);
    expect(FriendsView.parse(aView.json())).toEqual({ friends: [{ pairId: m.pairId, displayName: "Test B", canAsk: true, listingId: null, isSample: false, photo: null }] });
    expect(bView.statusCode).toBe(200);
    expect(FriendsView.parse(bView.json())).toEqual({ friends: [{ pairId: m.pairId, displayName: "Test A", canAsk: false, listingId: null, isSample: false, photo: null }] });
    expect(listerView.statusCode).toBe(200);
    expect(FriendsView.parse(listerView.json())).toEqual({ friends: [] });
  });
});
