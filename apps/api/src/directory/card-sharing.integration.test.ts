import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CardSharing, routes } from "@meet-first/contracts";
import {
  asPerson,
  createApprovedCard,
  createFrozenSource,
  createTestPerson,
} from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { TEST_APP_ORIGIN } from "../testing/app-factory.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerDirectoryRoutes } from "./index.js";

// The three turns every seeded person uploads. createApprovedCard quotes them in turn, so items 1
// and 4 quote the first, 2 and 5 the second, 3 and 6 the third.
const TURNS = [
  "I plan the week on Sunday night and keep to it.",
  "I answer messages only after lunch.",
  "Honest feedback matters more to me than comfort.",
];

// A seeded person: a session, a frozen source of TURNS, and an approved card whose items are all
// approved and verified.
type Member = {
  personId: string;
  sessionToken: string;
  cardId: string;
  itemIds: string[];
  turnIds: string[];
};

let t: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerDirectoryRoutes] });
});

afterAll(async () => {
  await t.close();
});

// Makes one person with a frozen source of TURNS and an approved card of this many items (6 unless
// given).
async function seedMember(displayName: string, items = 6): Promise<Member> {
  const person = await createTestPerson(t.db, displayName);
  const source = await createFrozenSource(t.db, person.personId, [...TURNS]);
  const card = await createApprovedCard(t.db, source.sourceId, { items });
  return {
    personId: person.personId,
    sessionToken: person.sessionToken,
    cardId: card.cardId,
    itemIds: card.itemIds,
    turnIds: source.turnIds,
  };
}

// Sends one request through the test app as this person, or with no session when null, always with
// the app's Origin, and with a JSON body when one is given.
function send(
  member: { sessionToken: string } | null,
  call: { method: "GET" | "PUT" | "POST" | "DELETE"; url: string; payload?: unknown },
) {
  const headers: Record<string, string> =
    member === null ? { origin: TEST_APP_ORIGIN } : sessionHeader(member.sessionToken);
  if (call.payload !== undefined) headers["content-type"] = "application/json";
  return t.app.inject({
    method: call.method,
    url: call.url,
    headers,
    ...(call.payload === undefined ? {} : { payload: JSON.stringify(call.payload) }),
  });
}

// The URL of a route with its :id filled in.
function pathOf(route: { path: string }, id: string): string {
  return route.path.replace(":id", id);
}

// Marks these positions of a card public, as its owner (the person's first card unless another card
// id is given).
async function markPublic(
  member: Member,
  positions: number[],
  cardId = member.cardId,
): Promise<void> {
  await asPerson(t.db, member.personId, (trx) =>
    trx
      .updateTable("card_items")
      .set({ is_public: true })
      .where("card_id", "=", cardId)
      .where("position", "in", positions)
      .execute(),
  );
}

// Lists the person in the directory with their first card and this line, as that person; returns
// the listing id.
async function listMember(member: Member, line: string, isOpenToRomance = false): Promise<string> {
  const row = await asPerson(t.db, member.personId, (trx) =>
    trx
      .insertInto("directory_listings")
      .values({
        person_id: member.personId,
        card_id: member.cardId,
        line,
        open_to_romance: isOpenToRomance,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

// Gives the person a second approved card of six items on a second source of TURNS; returns its id.
async function secondCard(member: Member): Promise<string> {
  const source = await createFrozenSource(t.db, member.personId, [...TURNS]);
  return (await createApprovedCard(t.db, source.sourceId, { items: 6 })).cardId;
}

// The is_public flags of a card's items in position order, read as the card's owner.
async function publicFlags(member: Member, cardId = member.cardId): Promise<boolean[]> {
  const rows = await asPerson(t.db, member.personId, (trx) =>
    trx
      .selectFrom("card_items")
      .select(["position", "is_public"])
      .where("card_id", "=", cardId)
      .orderBy("position", "asc")
      .execute(),
  );
  return rows.map((row) => row.is_public);
}

// Holds the person's people row with FOR NO KEY UPDATE in a transaction of its own until release is
// called; resolves once the row is held.
async function holdPersonRow(
  member: Member,
): Promise<{ release: () => void; done: Promise<void> }> {
  let release = (): void => undefined;
  let markHeld = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = asPerson(t.db, member.personId, async (trx) => {
    await trx
      .selectFrom("people")
      .select("id")
      .where("id", "=", member.personId)
      .forNoKeyUpdate()
      .execute();
    markHeld();
    await released;
  });
  await held;
  return { release, done };
}

describe("card sharing routes", () => {
  it("W6-DAPI-T4 (design section 6, P1, P3): a new approved card reads as the friends switch off and no public item", async () => {
    const ana = await seedMember("Ana Sharing");

    const response = await send(ana, {
      method: "GET",
      url: pathOf(routes.directory.readSharing, ana.cardId),
    });

    expect(response.statusCode).toBe(200);
    expect(CardSharing.parse(response.json())).toEqual({
      friendsCanAsk: false,
      publicPositions: [],
    });
  });

  it("W6-DAPI-T5 (design section 6, P1, P3): saving makes exactly the chosen positions public and sets the friends switch", async () => {
    const ben = await seedMember("Ben Sharing");

    const saved = await send(ben, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, ben.cardId),
      payload: { friendsCanAsk: true, publicPositions: [3, 1, 3] },
    });
    const flags = await publicFlags(ben);
    const friendsFlag = await asPerson(t.db, ben.personId, (trx) =>
      trx
        .selectFrom("cards")
        .select("friends_can_ask")
        .where("id", "=", ben.cardId)
        .executeTakeFirstOrThrow(),
    );
    const read = await send(ben, {
      method: "GET",
      url: pathOf(routes.directory.readSharing, ben.cardId),
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ friendsCanAsk: true, publicPositions: [1, 3] });
    expect(flags).toEqual([true, false, true, false, false, false]);
    expect(friendsFlag).toEqual({ friends_can_ask: true });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ friendsCanAsk: true, publicPositions: [1, 3] });
  });

  it("W6-DAPI-T6 (design section 6): a second save turns off the positions it leaves out, and an empty choice turns every item private", async () => {
    const cara = await seedMember("Cara Sharing");
    await send(cara, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, cara.cardId),
      payload: { friendsCanAsk: true, publicPositions: [1, 3] },
    });

    const second = await send(cara, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, cara.cardId),
      payload: { friendsCanAsk: false, publicPositions: [2] },
    });
    const secondFlags = await publicFlags(cara);
    const third = await send(cara, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, cara.cardId),
      payload: { friendsCanAsk: false, publicPositions: [] },
    });
    const thirdFlags = await publicFlags(cara);

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ friendsCanAsk: false, publicPositions: [2] });
    expect(secondFlags).toEqual([false, true, false, false, false, false]);
    expect(third.statusCode).toBe(200);
    expect(third.json()).toEqual({ friendsCanAsk: false, publicPositions: [] });
    expect(thirdFlags).toEqual([false, false, false, false, false, false]);
  });

  it("W6-DAPI-T7 (design section 6): another person's card and an id that is not a uuid are 404 not_found, and nothing changes", async () => {
    const dan = await seedMember("Dan Sharing");
    const eve = await seedMember("Eve Sharing");

    const ownRead = await send(dan, {
      method: "GET",
      url: pathOf(routes.directory.readSharing, dan.cardId),
    });
    expect(ownRead.statusCode).toBe(200);

    const readOther = await send(eve, {
      method: "GET",
      url: pathOf(routes.directory.readSharing, dan.cardId),
    });
    const saveOther = await send(eve, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, dan.cardId),
      payload: { friendsCanAsk: true, publicPositions: [1] },
    });
    const readBadId = await send(dan, {
      method: "GET",
      url: pathOf(routes.directory.readSharing, "not-a-uuid"),
    });
    const saveBadId = await send(dan, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, "not-a-uuid"),
      payload: { friendsCanAsk: true, publicPositions: [1] },
    });
    const flags = await publicFlags(dan);
    const friendsFlag = await asPerson(t.db, dan.personId, (trx) =>
      trx
        .selectFrom("cards")
        .select("friends_can_ask")
        .where("id", "=", dan.cardId)
        .executeTakeFirstOrThrow(),
    );

    const notFound = { code: "not_found", message: "This no longer exists or is not yours." };
    expect(readOther.statusCode).toBe(404);
    expect(readOther.json()).toEqual(notFound);
    expect(saveOther.statusCode).toBe(404);
    expect(saveOther.json()).toEqual(notFound);
    expect(readBadId.statusCode).toBe(404);
    expect(readBadId.json()).toEqual(notFound);
    expect(saveBadId.statusCode).toBe(404);
    expect(saveBadId.json()).toEqual(notFound);
    expect(flags).toEqual([false, false, false, false, false, false]);
    expect(friendsFlag).toEqual({ friends_can_ask: false });
  });

  it("W6-DAPI-T8 (design section 6): a card that is not approved is 409 card_not_approved on save, and still reads", async () => {
    const fay = await seedMember("Fay Sharing");
    await asPerson(t.db, fay.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ state: "ready", approved_at: null })
        .where("id", "=", fay.cardId)
        .execute(),
    );

    const saved = await send(fay, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, fay.cardId),
      payload: { friendsCanAsk: true, publicPositions: [1] },
    });
    const read = await send(fay, {
      method: "GET",
      url: pathOf(routes.directory.readSharing, fay.cardId),
    });
    const flags = await publicFlags(fay);

    expect(saved.statusCode).toBe(409);
    expect(saved.json()).toEqual({
      code: "card_not_approved",
      message: "approve your card before creating a meeting.",
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ friendsCanAsk: false, publicPositions: [] });
    expect(flags).toEqual([false, false, false, false, false, false]);
  });

  it("W6-DAPI-T9 (design section 6, P1): a position that is not an approved item with a found quote is 400 payload_invalid, and nothing changes", async () => {
    const gus = await seedMember("Gus Sharing");
    await asPerson(t.db, gus.personId, (trx) =>
      trx
        .updateTable("card_items")
        .set({ approved: false })
        .where("card_id", "=", gus.cardId)
        .where("position", "=", 2)
        .execute(),
    );
    await asPerson(t.db, gus.personId, (trx) =>
      trx
        .updateTable("card_items")
        .set({ verified: false, flagged: true })
        .where("card_id", "=", gus.cardId)
        .where("position", "=", 3)
        .execute(),
    );

    const first = await send(gus, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, gus.cardId),
      payload: { friendsCanAsk: true, publicPositions: [1, 2] },
    });
    const second = await send(gus, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, gus.cardId),
      payload: { friendsCanAsk: true, publicPositions: [3] },
    });
    const third = await send(gus, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, gus.cardId),
      payload: { friendsCanAsk: true, publicPositions: [7] },
    });
    const flags = await publicFlags(gus);
    const friendsFlag = await asPerson(t.db, gus.personId, (trx) =>
      trx
        .selectFrom("cards")
        .select("friends_can_ask")
        .where("id", "=", gus.cardId)
        .executeTakeFirstOrThrow(),
    );

    const refusal = {
      code: "payload_invalid",
      message: "Only approved items with a found quote can be public.",
    };
    expect(first.statusCode).toBe(400);
    expect(first.json()).toEqual(refusal);
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual(refusal);
    expect(third.statusCode).toBe(400);
    expect(third.json()).toEqual(refusal);
    expect(flags).toEqual([false, false, false, false, false, false]);
    expect(friendsFlag).toEqual({ friends_can_ask: false });
  });

  it("W6-DAPI-T10 (design section 6): a body CardSharing refuses is 400 payload_invalid with the shared sentence", async () => {
    const hal = await seedMember("Hal Sharing");

    const missingSwitch = await send(hal, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, hal.cardId),
      payload: { publicPositions: [1] },
    });
    const zeroPosition = await send(hal, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, hal.cardId),
      payload: { friendsCanAsk: true, publicPositions: [0] },
    });
    const wordSwitch = await send(hal, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, hal.cardId),
      payload: { friendsCanAsk: "yes", publicPositions: [] },
    });
    const flags = await publicFlags(hal);

    const refusal = {
      code: "payload_invalid",
      message: "The request body did not match the expected shape. Reload and try again.",
    };
    expect(missingSwitch.statusCode).toBe(400);
    expect(missingSwitch.json()).toEqual(refusal);
    expect(zeroPosition.statusCode).toBe(400);
    expect(zeroPosition.json()).toEqual(refusal);
    expect(wordSwitch.statusCode).toBe(400);
    expect(wordSwitch.json()).toEqual(refusal);
    expect(flags).toEqual([false, false, false, false, false, false]);
  });

  it("W6-DAPI-T11 (design section 6, P2): the listed card keeps at least one public item", async () => {
    const ivy = await seedMember("Ivy Sharing");
    await markPublic(ivy, [1, 2]);
    await listMember(ivy, "I like planning.");

    const emptied = await send(ivy, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, ivy.cardId),
      payload: { friendsCanAsk: false, publicPositions: [] },
    });
    const flagsAfterRefusal = await publicFlags(ivy);
    const kept = await send(ivy, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, ivy.cardId),
      payload: { friendsCanAsk: false, publicPositions: [2] },
    });

    expect(emptied.statusCode).toBe(409);
    expect(emptied.json()).toEqual({
      code: "listing_needs_public_item",
      message:
        "To stay in Explore you need at least one public item. Mark one, or leave Explore first.",
    });
    expect(flagsAfterRefusal).toEqual([true, true, false, false, false, false]);
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toEqual({ friendsCanAsk: false, publicPositions: [2] });
  });

  it("W6-DAPI-T12 (design section 6): emptying a card that is not the listed one is allowed", async () => {
    const jon = await seedMember("Jon Sharing");
    const other = await secondCard(jon);
    await markPublic(jon, [1]);
    await listMember(jon, "I like maps.");
    await markPublic(jon, [1], other);

    const emptied = await send(jon, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, other),
      payload: { friendsCanAsk: false, publicPositions: [] },
    });
    const otherFlags = await publicFlags(jon, other);
    const listedFlags = await publicFlags(jon);

    expect(emptied.statusCode).toBe(200);
    expect(emptied.json()).toEqual({ friendsCanAsk: false, publicPositions: [] });
    expect(otherFlags).toEqual([false, false, false, false, false, false]);
    expect(listedFlags).toEqual([true, false, false, false, false, false]);
  });

  it("W6-DAPI-T13 (design section 6): a sharing change waits while another transaction holds the caller's people row", async () => {
    const kim = await seedMember("Kim Sharing");

    const hold = await holdPersonRow(kim);
    const pending = send(kim, {
      method: "PUT",
      url: pathOf(routes.directory.updateSharing, kim.cardId),
      payload: { friendsCanAsk: true, publicPositions: [1] },
    });
    const early = await Promise.race([
      pending.then(() => "finished"),
      new Promise((resolve) =>
        setTimeout(() => {
          resolve("waiting");
        }, 300),
      ),
    ]);
    hold.release();
    await hold.done;
    const response = await pending;

    expect(early).toBe("waiting");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ friendsCanAsk: true, publicPositions: [1] });
  });
});
