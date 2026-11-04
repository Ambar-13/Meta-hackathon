import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CardItemSource,
  CardRequestResponse,
  CardView,
  ErrorBody,
  routes,
  SESSION_COOKIE,
} from "@meet-first/contracts";
import {
  asPerson,
  createApprovedCard,
  createFrozenSource,
  createTestPerson,
} from "@meet-first/db/testing";
import { normQuote } from "@meet-first/receipts";
import { buildTestApp } from "../testing/index.js";
import { enqueuedJobs } from "../testing/app-factory.js";
import { registerCardsRoutes } from "./index.js";

// The origin every request of this file carries: the test app's own address.
const ORIGIN = "http://localhost:3000";
// The six messages every owner's source holds, so a card has enough turns to quote.
const SIX_TURNS = [
  "I plan the whole week on Sunday night.",
  "I answer messages only after lunch.",
  "I want to lead a small team next year.",
  "Honest feedback matters more than comfort.",
  "I walk for ten minutes after every long call.",
  "I keep one notebook for every project I run.",
];
// The body of a 404 from the cards routes.
const NOT_FOUND = { code: "not_found", message: "This no longer exists or is not yours." };
// The first curly-apostrophe message of the item source test, written as an escape.
const TURN_0 = "I keep my desk tidy so the next morning starts calm.";
const TURN_1 = "Deadlines are promises, so I don’t move one without asking first.";

let t: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  t = await buildTestApp({ routes: [registerCardsRoutes], env: { APP_ORIGIN: ORIGIN } });
});
afterAll(async () => {
  await t.close();
});

// A person and a session cookie for one test.
type Person = { personId: string; sessionToken: string };

// Sends one request as the person (or as nobody when none is given), with the test app's origin.
async function send(
  person: Person | undefined,
  url: string,
  init: { method: "GET" | "POST"; payload?: unknown },
): Promise<{ statusCode: number; body: unknown }> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (person !== undefined) headers.cookie = `${SESSION_COOKIE}=${person.sessionToken}`;
  const payload = init.payload;
  const response = await t.app.inject({
    method: init.method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return {
    statusCode: response.statusCode,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
  };
}

// A GET as the person, with the test app origin.
function getAs(
  person: Person | undefined,
  url: string,
): Promise<{ statusCode: number; body: unknown }> {
  return send(person, url, { method: "GET" });
}
// A POST as the person, with an optional JSON body.
function postAs(
  person: Person | undefined,
  url: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: unknown }> {
  return send(
    person,
    url,
    payload === undefined ? { method: "POST" } : { method: "POST", payload },
  );
}

// The path of one route, with its id (and position) filled in.
function requestCardPath(id: string): string {
  return routes.sources.requestCard.path.replace(":id", id);
}
function readCardPath(id: string): string {
  return routes.cards.readCard.path.replace(":id", id);
}
function approvePath(id: string): string {
  return routes.cards.approveCard.path.replace(":id", id);
}
function itemSourcePath(id: string, position: number): string {
  return routes.cards.readItemSource.path.replace(":id", id).replace(":position", String(position));
}

// A source of six turns for a new owner, frozen.
async function ownerWithSource(): Promise<{ owner: Person; stranger: Person; sourceId: string }> {
  const owner = await createTestPerson(t.db, "Card Owner");
  const stranger = await createTestPerson(t.db, "Stranger");
  const source = await createFrozenSource(t.db, owner.personId, SIX_TURNS);
  return {
    owner: { personId: owner.personId, sessionToken: owner.sessionToken },
    stranger: { personId: stranger.personId, sessionToken: stranger.sessionToken },
    sourceId: source.sourceId,
  };
}

// The cards rows of one source, as its owner reads them.
async function cardsOf(
  owner: Person,
  sourceId: string,
): Promise<Array<{ id: string; state: string }>> {
  return asPerson(t.db, owner.personId, (trx) =>
    trx.selectFrom("cards").select(["id", "state"]).where("source_id", "=", sourceId).execute(),
  );
}

describe("the card routes", () => {
  it("R3.4-T1: requesting a card makes one building card and enqueues build_card after the commit", async () => {
    const { owner, sourceId } = await ownerWithSource();
    const response = await postAs(owner, requestCardPath(sourceId));
    expect(response.statusCode).toBe(202);
    const body = CardRequestResponse.parse(response.body);
    const cards = await asPerson(t.db, owner.personId, (trx) =>
      trx
        .selectFrom("cards")
        .select(["state", "model", "prompt_version"])
        .where("source_id", "=", sourceId)
        .execute(),
    );
    expect(cards).toEqual([{ state: "building", model: "pending", prompt_version: "pending" }]);
    expect(enqueuedJobs(t.app).at(-1)).toEqual({
      name: "build_card",
      payload: { cardId: body.cardId, personId: owner.personId },
    });
  });

  it("INV4-T1: a source that is not frozen cannot get a card", async () => {
    const owner = await createTestPerson(t.db, "Unfrozen Owner");
    const ownerPerson = { personId: owner.personId, sessionToken: owner.sessionToken };
    const sourceId = await asPerson(t.db, owner.personId, async (trx) => {
      const source = await trx
        .insertInto("sources")
        .values({
          person_id: owner.personId,
          kind: "paste",
          content_hash: createHash("sha256").update(randomUUID()).digest(),
          turn_count: 1,
          canonical_chars: 40,
          persona_signal: "0.500",
          parser_version: "1",
          scrub_version: "1",
          attested_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("turns")
        .values({
          source_id: source.id,
          person_id: owner.personId,
          turn_index: 0,
          role: "user",
          text: "I keep a notebook for every project.",
          norm_text: normQuote("I keep a notebook for every project."),
        })
        .execute();
      return source.id;
    });
    const response = await postAs(ownerPerson, requestCardPath(sourceId));
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      code: "source_not_frozen",
      message: "Finish the names review before building a card.",
    });
    expect(await cardsOf(ownerPerson, sourceId)).toHaveLength(0);
  });

  it("D60-T6: a third card request for one source on one UTC day gets 429 card_daily_cap", async () => {
    const { owner, sourceId } = await ownerWithSource();
    const statuses = [
      (await postAs(owner, requestCardPath(sourceId))).statusCode,
      (await postAs(owner, requestCardPath(sourceId))).statusCode,
    ];
    const third = await postAs(owner, requestCardPath(sourceId));
    expect(statuses).toEqual([202, 202]);
    expect(third.statusCode).toBe(429);
    expect(third.body).toEqual({
      code: "card_daily_cap",
      message: "This source already had 2 card builds today. Try again after midnight UTC.",
    });
    expect(await cardsOf(owner, sourceId)).toHaveLength(2);
  });

  it("D60-T7: five card requests for one source sent at once still make only 2 builds", async () => {
    const { owner, sourceId } = await ownerWithSource();

    const replies = await Promise.all(
      Array.from({ length: 5 }, () => postAs(owner, requestCardPath(sourceId))),
    );

    expect(replies.map((reply) => reply.statusCode).sort()).toEqual([202, 202, 429, 429, 429]);
    expect(await cardsOf(owner, sourceId)).toHaveLength(2);
  });

  it("D60-T8: a card request waits while another transaction holds its source row", async () => {
    const { owner, sourceId } = await ownerWithSource();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // FOR NO KEY UPDATE: the card insert's foreign-key check does not wait on it, so only the
    // route's own row lock can make the request wait.
    const holder = asPerson(t.db, owner.personId, async (trx) => {
      await trx
        .selectFrom("sources")
        .select("id")
        .where("id", "=", sourceId)
        .forNoKeyUpdate()
        .execute();
      await held;
    });

    const request = postAs(owner, requestCardPath(sourceId));
    const early = await Promise.race([
      request.then(() => "finished"),
      new Promise((resolve) =>
        setTimeout(() => {
          resolve("waiting");
        }, 300),
      ),
    ]);
    release();
    await holder;
    const reply = await request;

    expect(early).toBe("waiting");
    expect(reply.statusCode).toBe(202);
  });

  it("R3.4-T3: another person's source and a malformed id are 404 not_found", async () => {
    const { owner, stranger, sourceId } = await ownerWithSource();
    const other = await postAs(stranger, requestCardPath(sourceId));
    const malformed = await postAs(owner, requestCardPath("not-a-uuid"));
    expect(other).toEqual({ statusCode: 404, body: NOT_FOUND });
    expect(malformed).toEqual({ statusCode: 404, body: NOT_FOUND });
    expect(await cardsOf(owner, sourceId)).toHaveLength(0);
  });

  it("R3.4-T4: reading a card returns CardView with the server time, to its owner only", async () => {
    const { owner, stranger, sourceId } = await ownerWithSource();
    const card = await createApprovedCard(t.db, sourceId, { items: 6 });
    const mine = await getAs(owner, readCardPath(card.cardId));
    const theirs = await getAs(stranger, readCardPath(card.cardId));
    expect(mine.statusCode).toBe(200);
    const view = CardView.parse(mine.body);
    expect(view.state).toBe("approved");
    expect(view.items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Math.abs(Date.parse(view.serverNow) - Date.now())).toBeLessThan(5000);
    expect(theirs).toEqual({ statusCode: 404, body: NOT_FOUND });
  });

  it("R7.1-T1: approving keeps only the chosen items and sets the recall switch", async () => {
    const { owner, sourceId } = await ownerWithSource();
    const card = await createApprovedCard(t.db, sourceId, { items: 6 });
    await asPerson(t.db, owner.personId, async (trx) => {
      await trx
        .updateTable("cards")
        .set({ state: "ready", approved_at: null, recall_allowed: false })
        .where("id", "=", card.cardId)
        .execute();
      await trx
        .updateTable("card_items")
        .set({ approved: false })
        .where("card_id", "=", card.cardId)
        .execute();
    });
    const response = await postAs(owner, approvePath(card.cardId), {
      itemIds: [card.itemIds[0], card.itemIds[2]],
      recallAllowed: true,
    });
    expect(response).toEqual({ statusCode: 200, body: { state: "approved" } });
    const row = await asPerson(t.db, owner.personId, (trx) =>
      trx
        .selectFrom("cards")
        .select(["state", "recall_allowed", "approved_at"])
        .where("id", "=", card.cardId)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toMatchObject({ state: "approved", recall_allowed: true });
    expect(row.approved_at).not.toBeNull();
    const approved = await asPerson(t.db, owner.personId, (trx) =>
      trx
        .selectFrom("card_items")
        .select("id")
        .where("card_id", "=", card.cardId)
        .where("approved", "=", true)
        .execute(),
    );
    expect(approved.map((item) => item.id).sort()).toEqual(
      [card.itemIds[0], card.itemIds[2]].sort(),
    );
    const corpus = await asPerson(t.db, owner.personId, (trx) =>
      trx
        .selectFrom("recall_corpus")
        .select("turn_id")
        .where("card_id", "=", card.cardId)
        .execute(),
    );
    expect(corpus).toHaveLength(6);
  });

  it("INV16-T1: with the recall switch off, recall_corpus holds no row of the card", async () => {
    const { owner, sourceId } = await ownerWithSource();
    const card = await createApprovedCard(t.db, sourceId, { items: 6 });
    await asPerson(t.db, owner.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ state: "ready", approved_at: null, recall_allowed: false })
        .where("id", "=", card.cardId)
        .execute(),
    );
    const response = await postAs(owner, approvePath(card.cardId), {
      itemIds: [card.itemIds[0]],
      recallAllowed: false,
    });
    expect(response.statusCode).toBe(200);
    const row = await asPerson(t.db, owner.personId, (trx) =>
      trx
        .selectFrom("cards")
        .select("recall_allowed")
        .where("id", "=", card.cardId)
        .executeTakeFirstOrThrow(),
    );
    expect(row.recall_allowed).toBe(false);
    const corpus = await asPerson(t.db, owner.personId, (trx) =>
      trx
        .selectFrom("recall_corpus")
        .select("turn_id")
        .where("card_id", "=", card.cardId)
        .execute(),
    );
    expect(corpus).toHaveLength(0);
  });

  it("R7.1-T2: an approval that names an item of another card is refused", async () => {
    const { owner, sourceId } = await ownerWithSource();
    const card = await createApprovedCard(t.db, sourceId, { items: 6 });
    const other = await createApprovedCard(
      t.db,
      (await createFrozenSource(t.db, owner.personId, SIX_TURNS)).sourceId,
      { items: 6 },
    );
    await asPerson(t.db, owner.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ state: "ready", approved_at: null })
        .where("id", "=", card.cardId)
        .execute(),
    );
    const response = await postAs(owner, approvePath(card.cardId), {
      itemIds: [card.itemIds[0], other.itemIds[0]],
      recallAllowed: true,
    });
    expect(response).toEqual({
      statusCode: 400,
      body: {
        code: "card_item_unknown",
        message: "One of the chosen items is not on this card. Reload the card and choose again.",
      },
    });
    const row = await asPerson(t.db, owner.personId, (trx) =>
      trx
        .selectFrom("cards")
        .select("state")
        .where("id", "=", card.cardId)
        .executeTakeFirstOrThrow(),
    );
    expect(row.state).toBe("ready");
  });

  it("R7.1-T3: an approval with no item is refused, and an approved card cannot be approved again", async () => {
    const { owner, sourceId } = await ownerWithSource();
    const card = await createApprovedCard(t.db, sourceId, { items: 6 });
    await asPerson(t.db, owner.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ state: "ready", approved_at: null })
        .where("id", "=", card.cardId)
        .execute(),
    );
    const none = await postAs(owner, approvePath(card.cardId), {
      itemIds: [],
      recallAllowed: true,
    });
    const once = await postAs(owner, approvePath(card.cardId), {
      itemIds: [card.itemIds[0]],
      recallAllowed: true,
    });
    const again = await postAs(owner, approvePath(card.cardId), {
      itemIds: [card.itemIds[0]],
      recallAllowed: true,
    });
    expect(none).toEqual({
      statusCode: 400,
      body: { code: "card_items_none", message: "Choose at least one item to approve." },
    });
    expect(once.statusCode).toBe(200);
    expect(again).toEqual({
      statusCode: 409,
      body: {
        code: "card_already_approved",
        message: "This card is already approved. Its items cannot change now.",
      },
    });
  });

  it("D23-T2: a thin card can be approved", async () => {
    const { owner, sourceId } = await ownerWithSource();
    const card = await createApprovedCard(t.db, sourceId, { items: 6 });
    await asPerson(t.db, owner.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ state: "thin", thin: true, approved_at: null })
        .where("id", "=", card.cardId)
        .execute(),
    );
    const response = await postAs(owner, approvePath(card.cardId), {
      itemIds: [card.itemIds[0]],
      recallAllowed: true,
    });
    expect(response).toEqual({ statusCode: 200, body: { state: "approved" } });
  });

  it("R3.2-T5: the item source route returns the quote's message with the quote's range in the original text", async () => {
    const { owner, cardId } = await seedQuoteCard();
    const response = await getAs(owner, itemSourcePath(cardId, 1));
    expect(response.statusCode).toBe(200);
    expect(CardItemSource.parse(response.body)).toEqual({
      turnIndex: 1,
      text: TURN_1,
      highlight: { start: 24, end: 51 },
    });
    expect(TURN_1.slice(24, 51)).toBe("so I don’t move one without");
  });

  it("R3.2-T6: a quote that is not in its message gives a null highlight", async () => {
    const { owner, cardId } = await seedQuoteCard();
    const response = await getAs(owner, itemSourcePath(cardId, 2));
    expect(response).toEqual({
      statusCode: 200,
      body: { turnIndex: 0, text: TURN_0, highlight: null },
    });
  });

  it("R3.2-T7: the item source route answers the card's owner only, and a missing or malformed card or position is 404", async () => {
    const { owner, stranger, cardId } = await seedQuoteCard();
    const results = [
      await getAs(stranger, itemSourcePath(cardId, 1)),
      await getAs(owner, itemSourcePath(cardId, 3)),
      await getAs(owner, itemSourcePath(cardId, 0)),
      await getAs(owner, itemSourcePath(cardId, 41)),
      await getAs(
        owner,
        routes.cards.readItemSource.path.replace(":id", cardId).replace(":position", "abc"),
      ),
      await getAs(owner, itemSourcePath("not-a-uuid", 1)),
      await getAs(owner, itemSourcePath(randomUUID(), 1)),
    ];
    for (const result of results) expect(result).toEqual({ statusCode: 404, body: NOT_FOUND });
    expect(ErrorBody.parse(results[0]?.body).code).toBe("not_found");
  });
});

// Seeds the two-turn source and a card with one verified item and one flagged item, as the quote
// tests read them.
async function seedQuoteCard(): Promise<{ owner: Person; stranger: Person; cardId: string }> {
  const owner = await createTestPerson(t.db, "Quote Owner");
  const stranger = await createTestPerson(t.db, "Quote Stranger");
  const ownerPerson = { personId: owner.personId, sessionToken: owner.sessionToken };
  const source = await createFrozenSource(t.db, owner.personId, [TURN_0, TURN_1]);
  const cardId = await asPerson(t.db, owner.personId, async (trx) => {
    const card = await trx
      .insertInto("cards")
      .values({
        source_id: source.sourceId,
        person_id: owner.personId,
        state: "ready",
        model: "muse-spark-1.3",
        prompt_version: "v1",
        items_total: 2,
        items_verified: 1,
        built_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("card_items")
      .values([
        {
          card_id: card.id,
          person_id: owner.personId,
          position: 1,
          kind: "boundary",
          claim: "Asks before moving a deadline.",
          lang: "en",
          gloss: "Asks before moving a deadline.",
          turn_id: source.turnIds[1] ?? "",
          quote: "so I don't move one without",
          norm_quote: normQuote("so I don't move one without"),
          verified: true,
          flagged: false,
        },
        {
          card_id: card.id,
          person_id: owner.personId,
          position: 2,
          kind: "habit",
          claim: "Keeps a tidy desk.",
          lang: "en",
          gloss: "Keeps a tidy desk.",
          turn_id: source.turnIds[0] ?? "",
          quote: "words that are not in the message",
          norm_quote: normQuote("words that are not in the message"),
          verified: false,
          flagged: true,
        },
      ])
      .execute();
    return card.id;
  });
  return {
    owner: ownerPerson,
    stranger: { personId: stranger.personId, sessionToken: stranger.sessionToken },
    cardId,
  };
}
