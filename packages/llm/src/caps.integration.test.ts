import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { makeDatabase, POOL_SIZE, type Database } from "@meet-first/db";
import {
  asPerson,
  createTestPerson,
  freshTestDatabase,
  type TestDatabase,
} from "@meet-first/db/testing";
import { assertUnderCaps, CapReached, startOfUtcDay } from "./caps.js";

// The clock every cap test reads (a fake clock), and the caps the worker boots with in tests.
const NOW = new Date("2026-10-27T10:00:00.000Z");
const clock = (): Date => NOW;
const env = { DAILY_USD_CAP: 40, TOTAL_USD_CAP: 130 };

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

// Ledger rows with dollars written straight in, since the prices are not in the tests.
async function insertRows(
  personId: string,
  rows: Array<{ usd: number; startedAt: Date }>,
): Promise<void> {
  await asPerson(workerDb, personId, (trx) =>
    trx
      .insertInto("ledger")
      .values(
        rows.map((row) => ({
          person_id: personId,
          call_site: "card",
          model: "muse-spark-1.3",
          effort: "medium" as const,
          est_tokens: 1,
          usd: row.usd,
          status: "ok" as const,
          llm_mode: "replay" as const,
          started_at: row.startedAt,
        })),
      )
      .execute(),
  );
}

// The refusal an assertUnderCaps call makes, or undefined when it passes.
async function refusalOf(
  callSite: "card" | "speech" | "quiz_answer" | "scrub_names",
): Promise<CapReached | undefined> {
  const error = await assertUnderCaps(workerDb, env, { callSite, now: clock }).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  return error instanceof CapReached ? error : undefined;
}

describe("the dollar caps", () => {
  it("R3.7-T1: the 41st dollar of the day refuses a card call with the copy (fake clock)", async () => {
    const person = await createTestPerson(fresh.db, "Cap Test");
    await insertRows(person.personId, [
      { usd: 10, startedAt: NOW },
      { usd: 10, startedAt: NOW },
      { usd: 10, startedAt: NOW },
      { usd: 10, startedAt: NOW },
    ]);
    const error = await refusalOf("card");
    expect(error).toBeInstanceOf(CapReached);
    expect(error).toMatchObject({
      code: "daily_cap_reached",
      message: "card generation paused for today",
      httpStatus: 429,
    });
  });

  it("R3.7-T2: 39.999999 dollars allows the call (fake clock)", async () => {
    const person = await createTestPerson(fresh.db, "Cap Test");
    await insertRows(person.personId, [{ usd: 39.999999, startedAt: NOW }]);
    await expect(
      assertUnderCaps(workerDb, env, { callSite: "card", now: clock }),
    ).resolves.toBeUndefined();
  });

  it("D60-T1: meeting call sites get the meeting copy and the rest the general copy (fake clock)", async () => {
    const person = await createTestPerson(fresh.db, "Cap Test");
    await insertRows(person.personId, [{ usd: 40, startedAt: NOW }]);
    expect((await refusalOf("speech"))?.message).toBe("meetings are paused for today");
    expect((await refusalOf("quiz_answer"))?.message).toBe("model calls are paused for today");
    expect((await refusalOf("scrub_names"))?.message).toBe("card generation paused for today");
  });

  it("R10.6-T1: 130 dollars in all refuses with the total copy before the daily check (fake clock)", async () => {
    const person = await createTestPerson(fresh.db, "Cap Test");
    await insertRows(person.personId, [
      { usd: 130, startedAt: new Date("2026-10-24T10:00:00.000Z") },
    ]);
    const error = await refusalOf("card");
    expect(error).toMatchObject({
      code: "total_cap_reached",
      message: "the model budget for this event is used up",
    });
  });

  it("D60-T2: dollars spent before midnight UTC do not count toward today's cap (fake clock)", async () => {
    const person = await createTestPerson(fresh.db, "Cap Test");
    await insertRows(person.personId, [
      { usd: 40, startedAt: new Date("2026-10-26T23:59:59.999Z") },
    ]);
    await expect(
      assertUnderCaps(workerDb, env, { callSite: "card", now: clock }),
    ).resolves.toBeUndefined();
  });

  it("D60-T3: startOfUtcDay returns the UTC midnight of the instant", () => {
    expect(startOfUtcDay(new Date("2026-10-27T23:59:59.999+08:00")).toISOString()).toBe(
      "2026-10-27T00:00:00.000Z",
    );
  });

  it("INV14-T2: the caps add up the rows of every person (fake clock)", async () => {
    const personA = await createTestPerson(fresh.db, "Person A");
    const personB = await createTestPerson(fresh.db, "Person B");
    await insertRows(personA.personId, [{ usd: 20, startedAt: NOW }]);
    await insertRows(personB.personId, [{ usd: 20, startedAt: NOW }]);
    expect(await refusalOf("card")).toMatchObject({ code: "daily_cap_reached" });
  });
});
