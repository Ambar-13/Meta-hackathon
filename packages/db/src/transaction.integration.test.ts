import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { sql, type Kysely } from "kysely";
import { ContractError } from "@meet-first/contracts";
import { makeDatabase, numberFromPostgres, POOL_SIZE } from "./client.js";
import {
  assertOneContext,
  withMeeting,
  withPerson,
  type DatabaseTransaction,
} from "./transaction.js";
import {
  asPerson,
  createPairedMeetingWithTurns,
  freshTestDatabase,
  sha256Text,
  type SeededMeeting,
  type TestDatabase,
} from "./testing/index.js";
import type { Database } from "./types.js";

let t: TestDatabase;
let one: Kysely<Database>;
let m: SeededMeeting;

// Reads the two settings of the current transaction, with the empty text read as null.
async function readSettings(
  trx: DatabaseTransaction,
): Promise<{ person: string | null; meeting: string | null }> {
  const result = await sql<{
    person: string | null;
    meeting: string | null;
  }>`SELECT nullif(current_setting('app.person_id', true), '') AS person, nullif(current_setting('app.meeting_id', true), '') AS meeting`.execute(
    trx,
  );
  return result.rows[0] ?? { person: null, meeting: null };
}

// The error an action throws, or undefined when it succeeds.
async function caughtFrom(act: () => Promise<unknown>): Promise<unknown> {
  return act().then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

beforeAll(async () => {
  t = await freshTestDatabase();
  one = makeDatabase(t.apiUrl, 1);
  m = await createPairedMeetingWithTurns(t.db);
});

afterAll(async () => {
  await one.destroy();
  await t.drop();
});

describe("transaction wrappers", () => {
  it("D55-T1: withPerson sets app.person_id for its own transaction only", async () => {
    const inside = await withPerson(one, m.a.personId, readSettings);
    const after = await one.transaction().execute(readSettings);

    expect(inside).toEqual({ person: m.a.personId, meeting: null });
    expect(after).toEqual({ person: null, meeting: null });
  });

  it("D55-T2: withMeeting sets app.meeting_id for its own transaction only", async () => {
    const inside = await withMeeting(one, m.meetingId, readSettings);
    const after = await one.transaction().execute(readSettings);

    expect(inside).toEqual({ person: null, meeting: m.meetingId });
    expect(after).toEqual({ person: null, meeting: null });
  });

  it("D55-T3: withPerson refuses a transaction that would carry both settings", async () => {
    await sql`SELECT set_config('app.meeting_id', ${m.meetingId}, false)`.execute(one);
    const run = vi.fn(() => Promise.resolve(1));
    try {
      const error = await caughtFrom(() => withPerson(one, m.a.personId, run));

      expect(error).toBeInstanceOf(ContractError);
      expect(Reflect.get(error ?? {}, "code")).toBe("context_both_set");
      expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
      expect(Reflect.get(error ?? {}, "message")).toBe(
        "A transaction set both app.person_id and app.meeting_id. Use withPerson or withMeeting, not both.",
      );
      expect(run).toHaveBeenCalledTimes(0);
    } finally {
      await sql`SELECT set_config('app.meeting_id', '', false)`.execute(one);
    }
  });

  it("D55-T4: withMeeting refuses a transaction that would carry both settings", async () => {
    await sql`SELECT set_config('app.person_id', ${m.a.personId}, false)`.execute(one);
    const run = vi.fn(() => Promise.resolve(1));
    try {
      const error = await caughtFrom(() => withMeeting(one, m.meetingId, run));

      expect(error).toBeInstanceOf(ContractError);
      expect(Reflect.get(error ?? {}, "code")).toBe("context_both_set");
      expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
      expect(Reflect.get(error ?? {}, "message")).toBe(
        "A transaction set both app.person_id and app.meeting_id. Use withPerson or withMeeting, not both.",
      );
      expect(run).toHaveBeenCalledTimes(0);
    } finally {
      await sql`SELECT set_config('app.person_id', '', false)`.execute(one);
    }
  });

  it("D55-T5: assertOneContext refuses a transaction with neither setting", async () => {
    const error = await caughtFrom(() => one.transaction().execute((trx) => assertOneContext(trx)));

    expect(error).toBeInstanceOf(ContractError);
    expect(Reflect.get(error ?? {}, "code")).toBe("context_missing");
    expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
    expect(Reflect.get(error ?? {}, "message")).toBe(
      "A transaction set neither app.person_id nor app.meeting_id. Wrap the work in withPerson or withMeeting.",
    );
  });

  it("D55-T6: the wrappers refuse an id that is not a uuid", async () => {
    const run = vi.fn(() => Promise.resolve(1));
    const personError = await caughtFrom(() => withPerson(t.db, "not-a-uuid", run));
    const meetingError = await caughtFrom(() => withMeeting(t.db, "not-a-uuid", run));

    expect(Reflect.get(personError ?? {}, "code")).toBe("context_id_invalid");
    expect(Reflect.get(personError ?? {}, "httpStatus")).toBe(500);
    expect(Reflect.get(personError ?? {}, "message")).toBe(
      "The person id passed to withPerson or withMeeting is not a uuid. Pass the row id, not a token.",
    );
    expect(Reflect.get(meetingError ?? {}, "code")).toBe("context_id_invalid");
    expect(Reflect.get(meetingError ?? {}, "message")).toBe(
      "The meeting id passed to withPerson or withMeeting is not a uuid. Pass the row id, not a token.",
    );
    expect(run).toHaveBeenCalledTimes(0);
  });

  it("D55-T7: a throw inside run rolls the transaction back", async () => {
    const failure = await caughtFrom(() =>
      withPerson(t.db, m.a.personId, async (trx) => {
        await trx
          .insertInto("transfer_links")
          .values({
            person_id: m.a.personId,
            token_hash: sha256Text("rolled-back"),
            expires_at: new Date(Date.now() + 10 * 60_000),
          })
          .execute();
        throw new Error("stop");
      }),
    );
    const count = await asPerson(t.db, m.a.personId, (trx) =>
      sql<{
        n: string;
      }>`SELECT count(*) AS n FROM transfer_links WHERE token_hash = ${sha256Text("rolled-back")}`.execute(
        trx,
      ),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(Reflect.get(failure ?? {}, "message")).toBe("stop");
    expect(numberFromPostgres(count.rows[0]?.n)).toBe(0);
  });

  it("D55-T8: a pooled connection carries no person into the next transaction", async () => {
    const first = await withPerson(one, m.a.personId, (trx) =>
      sql<{ n: string }>`SELECT count(*) AS n FROM sessions`.execute(trx),
    );
    const second = await withPerson(one, m.b.personId, async (trx) => {
      const settings = await readSettings(trx);
      const count = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM sessions WHERE person_id = ${m.a.personId}::uuid`.execute(trx);
      return { settings, count: numberFromPostgres(count.rows[0]?.n) };
    });

    expect(numberFromPostgres(first.rows[0]?.n)).toBe(1);
    expect(second.settings.person).toBe(m.b.personId);
    expect(second.count).toBe(0);
  });

  it("D56-T1: the pool sizes are 10, 8, 2 and 4", () => {
    expect(POOL_SIZE).toEqual({ api: 10, worker: 8, migrate: 2, test: 4 });
  });

  it("D56-T2: a client with pool size 2 opens at most two connections", async () => {
    const two = makeDatabase(t.apiUrl, 2);
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          sql<{ pid: number }>`SELECT pg_backend_pid() AS pid, pg_sleep(0.3)`.execute(two),
        ),
      );
      const pids = new Set(results.map((result) => result.rows[0]?.pid));

      expect(pids.size).toBe(2);
    } finally {
      await two.destroy();
    }
  });

  it("D56-T3: numberFromPostgres reads Postgres numbers and refuses the rest", () => {
    expect(numberFromPostgres("42")).toBe(42);
    expect(numberFromPostgres(7)).toBe(7);
    expect(numberFromPostgres("3.500")).toBe(3.5);
    expect(numberFromPostgres("-2")).toBe(-2);
    for (const bad of ["abc", "", null, undefined, NaN, Infinity, {}]) {
      const error = (() => {
        try {
          numberFromPostgres(bad);
          return undefined;
        } catch (caught: unknown) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(ContractError);
      expect(Reflect.get(error ?? {}, "code")).toBe("postgres_number_invalid");
      expect(Reflect.get(error ?? {}, "httpStatus")).toBe(400);
    }
  });
});
