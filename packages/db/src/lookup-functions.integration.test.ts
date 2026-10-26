import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { parseDatabaseError } from "./database-errors.js";
import { asMeeting, asPerson, createPairedMeeting, createTestPerson, freshTestDatabase, sha256Text, type TestDatabase } from "./testing/index.js";
import type { Database } from "./types.js";

type PairedMeeting = Awaited<ReturnType<typeof createPairedMeeting>>;

// The error an action throws, or undefined when it succeeds.
async function caughtFrom(act: () => Promise<unknown>): Promise<unknown> {
  return act().then(() => undefined, (caught: unknown) => caught);
}

// One claim of a meeting slot: the rows the lookup returns, as state and queue position.
async function claimSlot(db: Kysely<Database>, meetingId: string, maxRunning: number): Promise<Array<{ state: string; queue_position: number | null }>> {
  const result = await sql<{ state: string; queue_position: number | null }>`SELECT * FROM claim_meeting_slot(${meetingId}::uuid, ${maxRunning})`.execute(db);
  return result.rows;
}

describe("recovery codes", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await freshTestDatabase();
  });

  afterAll(async () => {
    await t.drop();
  });

  it("INV20-T1: a recovery code redeems once", async () => {
    const p = await createTestPerson(t.db, "Test P");
    const first = await sql<{ person_id: string | null }>`SELECT auth_redeem_recovery(${sha256Text(p.recoveryCode)}, ${sha256Text("new-session-1")}) AS person_id`.execute(t.db);
    const second = await sql<{ person_id: string | null }>`SELECT auth_redeem_recovery(${sha256Text(p.recoveryCode)}, ${sha256Text("new-session-2")}) AS person_id`.execute(t.db);

    expect(first.rows[0]?.person_id).toBe(p.personId);
    expect(second.rows[0]?.person_id).toBeNull();
  });

  it("INV20-T2: a redeemed code is marked on the person", async () => {
    const p = await createTestPerson(t.db, "Test P");
    await sql`SELECT auth_redeem_recovery(${sha256Text(p.recoveryCode)}, ${sha256Text("new-session-3")}) AS person_id`.execute(t.db);
    const row = await asPerson(t.db, p.personId, (trx) => trx.selectFrom("people").select("recovery_code_used_at").where("id", "=", p.personId).executeTakeFirstOrThrow());

    expect(row.recovery_code_used_at).not.toBeNull();
  });

  it("INV20-T3: a deleted person's code does not redeem", async () => {
    const q = await createTestPerson(t.db, "Test Q");
    await asPerson(t.db, q.personId, (trx) => trx.updateTable("people").set({ state: "deleted" }).where("id", "=", q.personId).execute());
    const redeemed = await sql<{ person_id: string | null }>`SELECT auth_redeem_recovery(${sha256Text(q.recoveryCode)}, ${sha256Text("new-session-4")}) AS person_id`.execute(t.db);

    expect(redeemed.rows[0]?.person_id).toBeNull();
  });

  it("INV20-T4: two people cannot share one recovery hash", async () => {
    const first = await sql`SELECT auth_create_person('Copy one', ${[]}::text[], ${sha256Text("shared-code")}, ${sha256Text("session-one")})`.execute(t.db);
    const error = await caughtFrom(() => sql`SELECT auth_create_person('Copy two', ${[]}::text[], ${sha256Text("shared-code")}, ${sha256Text("session-two")})`.execute(t.db));

    expect(first.rows).toHaveLength(1);
    expect(parseDatabaseError(error)).toEqual({ code: "duplicate", message: "This already exists. Use the one that is there instead of making another." });
  });
});

describe("meeting slots", () => {
  let t: TestDatabase;
  let m1: PairedMeeting;
  let queued: PairedMeeting[] = [];

  beforeAll(async () => {
    t = await freshTestDatabase();
  });

  afterAll(async () => {
    await t.drop();
  });

  it("D57-T1: twenty claims at once start one meeting", async () => {
    m1 = await createPairedMeeting(t.db);
    const results = await Promise.all(Array.from({ length: 20 }, () => claimSlot(t.db, m1.meetingId, 40)));

    expect(results.filter((rows) => rows.length === 1)).toEqual([[{ state: "running", queue_position: null }]]);
    expect(results.filter((rows) => rows.length === 0)).toHaveLength(19);
  });

  it("D57-T2: a claim on a running meeting returns no row", async () => {
    const rows = await claimSlot(t.db, m1.meetingId, 40);

    expect(rows).toEqual([]);
  });

  it("D57-T3: the 41st meeting queues at position 1 and the 42nd at position 2", async () => {
    const meetings: PairedMeeting[] = [];
    for (let index = 2; index <= 42; index += 1) meetings.push(await createPairedMeeting(t.db));
    queued = meetings.slice(39);
    const results = [];
    for (const meeting of meetings) results.push(await claimSlot(t.db, meeting.meetingId, 40));

    expect(results.slice(0, 39)).toEqual(Array.from({ length: 39 }, () => [{ state: "running", queue_position: null }]));
    expect(results[39]).toEqual([{ state: "queued", queue_position: 1 }]);
    expect(results[40]).toEqual([{ state: "queued", queue_position: 2 }]);
  });

  it("D57-T4: a freed slot lets a queued meeting start", async () => {
    await asMeeting(t.db, m1.meetingId, (trx) => trx.updateTable("meetings").set({ state: "ended" }).where("id", "=", m1.meetingId).execute());
    const first = queued[0];
    const rows = await claimSlot(t.db, first?.meetingId ?? "", 40);

    expect(rows).toEqual([{ state: "running", queue_position: null }]);
  });
});
