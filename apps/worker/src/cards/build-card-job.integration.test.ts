import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDatabase, numberFromPostgres, POOL_SIZE, type Database } from "@meet-first/db";
import { asPerson, createFrozenSource, createTestPerson, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { normQuote } from "@meet-first/receipts";
import { CHAT_MODEL, LimiterBusy, requestChars, requestHash, type LlmRequest } from "@meet-first/llm";
import { assertRecordedUsage, cardCase, cardCaseCalls, fixtureRequest, makeTestJobContext, runJobOnce, type CardFixtureCase } from "../testing/index.js";
import { charsPerTokenFrom } from "./build-card-job.js";

const NOW = new Date("2026-10-27T10:00:00.000Z");

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
beforeEach(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});
afterEach(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// The ids a seeded card case gives its person, its source, its turns and its building card.
type Seeded = { personId: string; sourceId: string; turnIds: string[]; cardId: string };

// Writes ledger rows for the person through the worker, with the dollars and the start the test gives.
async function insertLedgerRows(personId: string, rows: Array<{ estTokens: number; usd?: number; startedAt?: Date }>): Promise<void> {
  await asPerson(workerDb, personId, (trx) =>
    trx.insertInto("ledger").values(rows.map((row) => ({
      person_id: personId, call_site: "card" as const, model: "muse-spark-1.3", effort: "medium" as const, est_tokens: row.estTokens,
      usd: row.usd ?? 0, status: "ok" as const, llm_mode: "replay" as const, ...(row.startedAt === undefined ? {} : { started_at: row.startedAt }),
    }))).execute(),
  );
}

// Seeds one card case: the person, a frozen source with the case's turns, the sensitive tags, the opt-ins and a building card.
async function seedCardCase(fixtureCase: CardFixtureCase): Promise<Seeded> {
  const person = await createTestPerson(fresh.db, fixtureCase.displayName);
  const source = await createFrozenSource(fresh.db, person.personId, [...fixtureCase.turns]);
  for (const [index, categories] of Object.entries(fixtureCase.sensitive)) {
    await asPerson(fresh.db, person.personId, (trx) => trx.updateTable("turns").set({ sensitive_categories: categories }).where("id", "=", source.turnIds[Number(index)] ?? "").execute());
  }
  if (fixtureCase.optIn.length > 0) {
    await asPerson(fresh.db, person.personId, (trx) => trx.updateTable("sources").set({ sensitive_opt_in: [...fixtureCase.optIn] }).where("id", "=", source.sourceId).execute());
  }
  const card = await asPerson(fresh.db, person.personId, (trx) =>
    trx.insertInto("cards").values({ source_id: source.sourceId, person_id: person.personId, state: "building", model: "pending", prompt_version: "pending" }).returning("id").executeTakeFirstOrThrow(),
  );
  return { personId: person.personId, sourceId: source.sourceId, turnIds: source.turnIds, cardId: card.id };
}

// The card row as the job left it.
async function readCard(seeded: Seeded): Promise<{ state: string; thin: boolean; items_total: number | null; items_verified: number | null; model: string; prompt_version: string; error: string | null; built_at: Date | null }> {
  return asPerson(workerDb, seeded.personId, (trx) =>
    trx.selectFrom("cards").select(["state", "thin", "items_total", "items_verified", "model", "prompt_version", "error", "built_at"]).where("id", "=", seeded.cardId).executeTakeFirstOrThrow(),
  );
}

// The item rows of the card, in position order.
async function readItems(seeded: Seeded): Promise<Array<{ position: number; kind: string; claim: string; lang: string; gloss: string; turn_id: string; quote: string; norm_quote: string; verified: boolean; flagged: boolean; sensitive: boolean }>> {
  return asPerson(workerDb, seeded.personId, (trx) =>
    trx.selectFrom("card_items").select(["position", "kind", "claim", "lang", "gloss", "turn_id", "quote", "norm_quote", "verified", "flagged", "sensitive"]).where("card_id", "=", seeded.cardId).orderBy("position", "asc").execute(),
  );
}

// The ledger rows of the person, in start order.
async function ledgerRows(seeded: Seeded): Promise<Array<{ call_site: string; status: string; llm_mode: string }>> {
  return asPerson(workerDb, seeded.personId, (trx) => trx.selectFrom("ledger").select(["call_site", "status", "llm_mode"]).orderBy("started_at").orderBy("id").execute());
}

// The request of one call of a card case, by its position in the case (the first call is 0).
function requestOf(name: string, index: number): LlmRequest {
  const call = cardCaseCalls(cardCase(name))[index];
  if (call === undefined) throw new Error(`no card call ${String(index)} in ${name}`);
  return fixtureRequest(call);
}

// The items of a case's first reply, as the model sent them.
function firstReplyItems(name: string): Array<Record<string, string>> {
  return (cardCase(name).firstReply as { items: Array<Record<string, string>> }).items;
}

describe("the card build job", () => {
  it("D21-T1: a card whose items all verify is ready with every item stored in order", async () => {
    const seeded = await seedCardCase(cardCase("card-ready"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect(await readCard(seeded)).toMatchObject({ state: "ready", thin: false, items_total: 7, items_verified: 7, error: null });
    expect((await readCard(seeded)).built_at).not.toBeNull();
    const items = await readItems(seeded);
    expect(items).toHaveLength(7);
    const expected = firstReplyItems("card-ready");
    items.forEach((row, index) => {
      const source = expected[index];
      expect(row).toMatchObject({ position: index + 1, kind: source?.kind, claim: source?.claim, lang: source?.lang, gloss: source?.gloss, quote: source?.quote, verified: true, flagged: false, sensitive: false });
      expect(row.turn_id).toBe(seeded.turnIds[Number(source?.turn_id)]);
      expect(row.norm_quote).toBe(normQuote(row.quote));
    });
  });

  it("R3.9-T1: the card records the model name and the prompt version", async () => {
    const seeded = await seedCardCase(cardCase("card-ready"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    const card = await readCard(seeded);
    expect(card.model).toBe(CHAT_MODEL);
    expect(card.prompt_version).toBe("v1");
  });

  it("R3.6-T1: a card whose items all verify takes exactly one card call", async () => {
    const seeded = await seedCardCase(cardCase("card-ready"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect(await ledgerRows(seeded)).toEqual([{ call_site: "card", status: "ok", llm_mode: "replay" }]);
  });

  it("D20-T1: the first card of a source stores chars_per_token from the reply's prompt tokens", async () => {
    const seeded = await seedCardCase(cardCase("card-ready"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    const source = await asPerson(workerDb, seeded.personId, (trx) => trx.selectFrom("sources").select("chars_per_token").where("id", "=", seeded.sourceId).executeTakeFirstOrThrow());
    const expected = charsPerTokenFrom(requestChars(requestOf("card-ready", 0).body), 2000);
    expect(numberFromPostgres(source.chars_per_token)).toBe(expected);
  });

  it("INV5-T1: every stored item names a turn of the card's own source", async () => {
    const seeded = await seedCardCase(cardCase("card-ready"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    for (const row of await readItems(seeded)) {
      expect(seeded.turnIds).toContain(row.turn_id);
    }
  });

  it("R3.2-T3: a quote that is not in its named turn is regenerated once and then dropped", async () => {
    const seeded = await seedCardCase(cardCase("card-regenerate"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    const ledger = await ledgerRows(seeded);
    expect(ledger).toEqual([{ call_site: "card", status: "ok", llm_mode: "replay" }, { call_site: "card", status: "ok", llm_mode: "replay" }]);
    expect(await readCard(seeded)).toMatchObject({ state: "ready", items_total: 7, items_verified: 6 });
    const claims = (await readItems(seeded)).map((row) => row.claim);
    expect(claims).toEqual(firstReplyItems("card-regenerate").slice(0, 6).map((item) => item.claim));
    expect(claims).not.toContain("Learns new tools by rebuilding old projects.");
  });

  it("D27-T2: the regeneration request is the one the fixture case builds", async () => {
    const seeded = await seedCardCase(cardCase("card-regenerate"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect((await ledgerRows(seeded)).some((row) => row.status === "error")).toBe(false);
    expect((await readCard(seeded)).state).toBe("ready");
  });

  it("R3.5-T5: a card takes at most 2 ledger rows", async () => {
    const seeded = await seedCardCase(cardCase("card-thin"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    const ledger = await ledgerRows(seeded);
    expect(ledger).toHaveLength(2);
    expect(ledger.every((row) => row.call_site === "card")).toBe(true);
  });

  it("D23-T1: fewer than 6 verified items marks the card thin", async () => {
    const seeded = await seedCardCase(cardCase("card-thin"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect(await readCard(seeded)).toMatchObject({ state: "thin", thin: true, items_total: 6, items_verified: 4 });
    const items = await readItems(seeded);
    expect(items.map((row) => row.claim)).toEqual(firstReplyItems("card-thin").slice(0, 4).map((item) => item.claim));
  });

  it("R3.2-T4: an item whose turn label is not in the sample is dropped", async () => {
    const seeded = await seedCardCase(cardCase("card-thin"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    const matches = (await readItems(seeded)).filter((row) => row.claim === "Declines meetings without an agenda.");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.turn_id).toBe(seeded.turnIds[1]);
  });

  it("R2.8-T3: a turn tagged sensitive and not opted in never reaches the card prompt", async () => {
    const seeded = await seedCardCase(cardCase("card-sensitive-excluded"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect((await readCard(seeded)).state).toBe("ready");
    expect((await readItems(seeded)).map((row) => row.turn_id)).not.toContain(seeded.turnIds[2]);
    expect(JSON.stringify(requestOf("card-sensitive-excluded", 0).body).includes("My doctor wants me to rest more")).toBe(false);
  });

  it("R2.8-T4: an opted-in sensitive turn may be quoted, and its item is marked sensitive", async () => {
    const seeded = await seedCardCase(cardCase("card-sensitive-opted-in"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    const items = await readItems(seeded);
    expect(items).toHaveLength(7);
    const sensitive = items.filter((row) => row.turn_id === seeded.turnIds[2]);
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0]).toMatchObject({ quote: "so I stopped working weekends", sensitive: true });
    expect(items.filter((row) => row.turn_id !== seeded.turnIds[2]).every((row) => !row.sensitive)).toBe(true);
  });

  it("R3.3-T3: the Tamil card's request stays under 1,048,576 tokens by its recorded usage", async () => {
    const seeded = await seedCardCase(cardCase("card-tamil"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect(await readCard(seeded)).toMatchObject({ state: "ready", items_total: 6 });
    const items = await readItems(seeded);
    expect(items.every((row) => row.lang === "ta")).toBe(true);
    expect(items.map((row) => row.gloss)).toEqual(firstReplyItems("card-tamil").map((item) => item.gloss));
    const hash = requestHash(requestOf("card-tamil", 0).body);
    expect(() => {
      assertRecordedUsage("card", hash, (usage) => usage.promptTokens < 1_048_576);
    }).not.toThrow();
  });

  it("D21-T7: a reply that fails the card schema fails the card with card_output_invalid", async () => {
    const seeded = await seedCardCase(cardCase("card-output-invalid"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect(await readCard(seeded)).toMatchObject({ state: "failed", error: "card_output_invalid" });
    expect(await readItems(seeded)).toHaveLength(0);
    expect(await ledgerRows(seeded)).toEqual([{ call_site: "card", status: "ok", llm_mode: "replay" }]);
  });

  it("D60-T5: the daily cap fails the card with daily_cap_reached and makes no call (fake clock)", async () => {
    const fixed = new Date("2026-10-27T10:00:00.000Z");
    const seeded = await seedCardCase(cardCase("card-ready"));
    await insertLedgerRows(seeded.personId, [{ estTokens: 1, usd: 40, startedAt: fixed }]);
    const { context } = makeTestJobContext({ db: workerDb, now: () => fixed });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect(await readCard(seeded)).toMatchObject({ state: "failed", error: "daily_cap_reached" });
    expect(await readItems(seeded)).toHaveLength(0);
    expect(await ledgerRows(seeded)).toEqual([{ call_site: "card", status: "ok", llm_mode: "replay" }]);
  });

  it("D58-T7: a full token window rethrows LimiterBusy from the task and leaves the card building", async () => {
    const seeded = await seedCardCase(cardCase("card-ready"));
    await insertLedgerRows(seeded.personId, [{ estTokens: 1_000_000 }, { estTokens: 1_000_000 }, { estTokens: 1_000_000 }]);
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    const error = await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LimiterBusy);
    expect(await readCard(seeded)).toMatchObject({ state: "building" });
    expect(await readItems(seeded)).toHaveLength(0);
  });

  it("D22-T3: a card that is no longer building is left alone and makes no call", async () => {
    const seeded = await seedCardCase(cardCase("card-ready"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    await runJobOnce(context, "build_card", { cardId: seeded.cardId, personId: seeded.personId });
    expect(await ledgerRows(seeded)).toHaveLength(1);
    expect(await readItems(seeded)).toHaveLength(7);
    expect((await readCard(seeded)).state).toBe("ready");
  });
});

