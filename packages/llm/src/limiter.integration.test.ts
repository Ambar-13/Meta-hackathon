import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { makeDatabase, POOL_SIZE, type Database } from "@meet-first/db";
import { asPerson, createTestPerson, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import type { Enqueue } from "@meet-first/contracts";
import { assertWindowHasRoom, LimiterBusy, reenqueueAfterLimiter } from "./limiter.js";

// The clock every limiter test reads (a fake clock): the retry time is five seconds after it.
const NOW = new Date("2026-10-27T10:00:00.000Z");
const clock = (): Date => NOW;

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

// One row of the ledger for a person, as a finished replay call; startedAt defaults to the database's now().
async function insertRows(personId: string, rows: Array<{ estTokens: number; callSite?: string; usd?: number; startedAt?: Date }>): Promise<void> {
  await asPerson(workerDb, personId, (trx) =>
    trx.insertInto("ledger").values(rows.map((row) => ({
      person_id: personId,
      call_site: row.callSite ?? "card",
      model: "muse-spark-1.3",
      effort: "medium" as const,
      est_tokens: row.estTokens,
      usd: row.usd ?? 0,
      status: "ok" as const,
      llm_mode: "replay" as const,
      ...(row.startedAt === undefined ? {} : { started_at: row.startedAt }),
    }))).execute(),
  );
}

describe("the shared token window", () => {
  it("D58-T1: a window at 3,000,000 estimated tokens refuses the next chat call with LimiterBusy (fake clock)", async () => {
    const person = await createTestPerson(fresh.db, "Limiter Test");
    await insertRows(person.personId, [{ estTokens: 1_000_000 }, { estTokens: 1_000_000 }, { estTokens: 1_000_000 }]);
    const error = await assertWindowHasRoom(workerDb, "chat", clock).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LimiterBusy);
    expect(error).toMatchObject({ code: "limiter_busy", httpStatus: 429, retryAtMs: new Date("2026-10-27T10:00:05.000Z").getTime() });
  });

  it("D58-T2: a window at 2,999,999 allows the call", async () => {
    const person = await createTestPerson(fresh.db, "Limiter Test");
    await insertRows(person.personId, [{ estTokens: 1_000_000 }, { estTokens: 1_000_000 }, { estTokens: 999_999 }]);
    await expect(assertWindowHasRoom(workerDb, "chat", clock)).resolves.toBeUndefined();
  });

  it("R10.4-T1: 2,000 calls in the window refuse the next call at 1 token each", async () => {
    const person = await createTestPerson(fresh.db, "Limiter Test");
    await insertRows(person.personId, Array.from({ length: 2000 }, () => ({ estTokens: 1 })));
    await expect(assertWindowHasRoom(workerDb, "chat", clock)).rejects.toBeInstanceOf(LimiterBusy);
  });

  it("D58-T3: 120 image calls refuse an image call and allow a chat call", async () => {
    const person = await createTestPerson(fresh.db, "Limiter Test");
    await insertRows(person.personId, Array.from({ length: 120 }, () => ({ estTokens: 1000, callSite: "comic_image" })));
    await expect(assertWindowHasRoom(workerDb, "image", clock)).rejects.toBeInstanceOf(LimiterBusy);
    await expect(assertWindowHasRoom(workerDb, "chat", clock)).resolves.toBeUndefined();
  });

  it("D58-T4: the limiter re-enqueues the job at now + 5 s (fake clock)", async () => {
    const recorded: Array<{ name: string; payload: unknown; options: unknown }> = [];
    const enqueue: Enqueue = (name, payload, options) => {
      recorded.push({ name, payload, options });
      return Promise.resolve();
    };
    const cardId = "00000000-0000-4000-8000-000000000001";
    const personId = "00000000-0000-4000-8000-000000000002";
    await reenqueueAfterLimiter({ enqueue, now: clock }, "build_card", { cardId, personId });
    expect(recorded).toEqual([{ name: "build_card", payload: { cardId, personId }, options: { runAt: new Date("2026-10-27T10:00:05.000Z") } }]);
  });

  it("INV14-T1: the limiter adds up the ledger rows of every person, and reads nothing else", async () => {
    const personA = await createTestPerson(fresh.db, "Person A");
    const personB = await createTestPerson(fresh.db, "Person B");
    await insertRows(personA.personId, [{ estTokens: 2_000_000 }]);
    await insertRows(personB.personId, [{ estTokens: 1_000_000 }]);
    await expect(assertWindowHasRoom(workerDb, "chat", clock)).rejects.toBeInstanceOf(LimiterBusy);
  });
});
