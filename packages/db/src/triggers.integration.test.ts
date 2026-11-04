import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { ContractError } from "@meet-first/contracts";
import { normQuote } from "@meet-first/receipts";
import { describeError, parseDatabaseError } from "./database-errors.js";
import { appendMeetingEvent, nextEventSeq } from "./event-seq.js";
import {
  asMeeting,
  asPerson,
  createFrozenSource,
  createPairedMeetingWithTurns,
  freshTestDatabase,
  sha256Text,
  SEED_TURNS_A,
  SEED_TURNS_B,
  type SeededMeeting,
  type TestDatabase,
} from "./testing/index.js";
import { type DatabaseTransaction } from "./transaction.js";
import type { Database } from "./types.js";
import { makeDatabase } from "./client.js";

let t: TestDatabase;

// Returns the item at index, and throws when the list is shorter.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The list has no item at index ${String(index)}.`);
  return item;
}

// The error an action throws, or undefined when it succeeds.
async function caughtFrom(act: () => Promise<unknown>): Promise<unknown> {
  return act().then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

// The Postgres code read off a thrown value, or undefined.
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
}

// Inserts an unfrozen source with its turns, as the upload does before the names review.
async function insertUnfrozenSource(
  db: Kysely<Database>,
  personId: string,
  texts: string[],
): Promise<{ sourceId: string; turnIds: string[] }> {
  return asPerson(db, personId, async (trx) => {
    const source = await trx
      .insertInto("sources")
      .values({
        person_id: personId,
        kind: "paste",
        content_hash: sha256Text(`${randomUUID()}\n${texts.join("\n")}`),
        turn_count: texts.length,
        canonical_chars: texts.reduce((sum, text) => sum + text.length, 0),
        persona_signal: "0.500",
        parser_version: "test",
        scrub_version: "test",
        attested_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const turns = await trx
      .insertInto("turns")
      .values(
        texts.map((text, index) => ({
          source_id: source.id,
          person_id: personId,
          turn_index: index,
          role: "user" as const,
          text,
          norm_text: normQuote(text),
        })),
      )
      .returning(["id", "turn_index"])
      .execute();
    return {
      sourceId: source.id,
      turnIds: turns.sort((a, b) => a.turn_index - b.turn_index).map((turn) => turn.id),
    };
  });
}

// Moves a meeting to a state inside its own context.
async function setMeetingState(
  db: Kysely<Database>,
  meetingId: string,
  state: "ready" | "queued" | "running" | "ended" | "deleted",
): Promise<void> {
  await asMeeting(db, meetingId, (trx) =>
    trx.updateTable("meetings").set({ state }).where("id", "=", meetingId).execute(),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// A started-event body for one meeting, at the time given.
function startedEvent(meetingId: string, at: string): Parameters<typeof appendMeetingEvent>[2] {
  return {
    v: 1,
    meetingId,
    at,
    type: "meeting.started",
    startedAt: at,
    endsAt: at,
    question: "A test question?",
    members: [
      { side: "a", displayName: "Test A" },
      { side: "b", displayName: "Test B" },
    ],
  };
}

beforeAll(async () => {
  t = await freshTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

describe("triggers", () => {
  it("INV1-T1: refuses a change to turn text after the source is frozen", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() =>
      asPerson(t.db, m.a.personId, (trx) =>
        trx
          .updateTable("turns")
          .set({ text: "This text was changed after the freeze." })
          .where("id", "=", at(m.a.turnIds, 0))
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "turn_text_frozen",
      message:
        "the source was frozen by the names review, so its turn text cannot change. Upload again to re-scrub.",
    });
  });

  it("INV1-T2: refuses a change to norm_text after the source is frozen", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() =>
      asPerson(t.db, m.a.personId, (trx) =>
        trx
          .updateTable("turns")
          .set({ norm_text: "changed after the freeze" })
          .where("id", "=", at(m.a.turnIds, 0))
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "turn_text_frozen",
      message:
        "the source was frozen by the names review, so its turn text cannot change. Upload again to re-scrub.",
    });
  });

  it("INV1-T3: allows a turn text change while the source is not frozen", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const u = await insertUnfrozenSource(t.db, m.a.personId, [
      "A turn written before any review took place.",
    ]);
    const result = await asPerson(t.db, m.a.personId, (trx) =>
      trx
        .updateTable("turns")
        .set({ text: "A turn rewritten before the names review." })
        .where("id", "=", at(u.turnIds, 0))
        .execute(),
    );

    expect(result.map((row) => row.numUpdatedRows)).toEqual([1n]);
  });

  it("INV1-T4: allows a change to another turn column after the freeze", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const result = await asPerson(t.db, m.a.personId, (trx) =>
      trx.updateTable("turns").set({ lang: "fr" }).where("id", "=", at(m.a.turnIds, 0)).execute(),
    );

    expect(result.map((row) => row.numUpdatedRows)).toEqual([1n]);
  });

  it("INV1-T5: parseDatabaseError returns null for anything that is not a Postgres refusal", () => {
    const values: unknown[] = [
      null,
      "text",
      new Error("plain"),
      new ContractError("not_found", "This no longer exists or is not yours.", 404),
      { code: "23503", message: "insert or update violates a foreign key" },
    ];

    expect(values.map((value) => parseDatabaseError(value))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("INV1-T6: a raise whose code is not on the list reads as null", async () => {
    const error = await caughtFrom(() =>
      sql`DO $$ BEGIN RAISE EXCEPTION 'made_up_code: a test sentence.' USING ERRCODE = 'check_violation'; END $$`.execute(
        t.db,
      ),
    );

    expect(codeOf(error)).toBe("23514");
    expect(parseDatabaseError(error)).toBeNull();
    expect(describeError(error)).toBe("made_up_code: a test sentence.");
  });

  it("INV4-T1: refuses a card on a source that is not frozen", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const u = await insertUnfrozenSource(t.db, m.a.personId, [
      "A turn written before any review took place.",
    ]);
    const error = await caughtFrom(() =>
      asPerson(t.db, m.a.personId, (trx) =>
        trx
          .insertInto("cards")
          .values({
            source_id: u.sourceId,
            person_id: m.a.personId,
            state: "building",
            model: "test-model",
            prompt_version: "test",
          })
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "card_source_not_frozen",
      message: "finish the names review before building a card.",
    });
  });

  it("INV5-T1: refuses a card item that quotes a turn of another source", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const other = await createFrozenSource(t.db, m.a.personId, [
      "A second source with a turn of its own here.",
    ]);
    const quote = "A second source with a turn of its own here.";
    const error = await caughtFrom(() =>
      asPerson(t.db, m.a.personId, (trx) =>
        trx
          .insertInto("card_items")
          .values({
            card_id: m.a.cardId,
            person_id: m.a.personId,
            position: 7,
            kind: "value",
            claim: "Test claim 7",
            lang: "en",
            gloss: "Test gloss 7",
            turn_id: at(other.turnIds, 0),
            quote,
            norm_quote: normQuote(quote),
            verified: true,
            flagged: false,
          })
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "card_item_foreign_turn",
      message: "a card item may only quote a turn of its own source.",
    });
  });

  it("INV5-T2: refuses moving a card item onto a turn of another source", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const other = await createFrozenSource(t.db, m.a.personId, [
      "A second source with a turn of its own here.",
    ]);
    const error = await caughtFrom(() =>
      asPerson(t.db, m.a.personId, (trx) =>
        trx
          .updateTable("card_items")
          .set({ turn_id: at(other.turnIds, 0) })
          .where("card_id", "=", m.a.cardId)
          .where("position", "=", 1)
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "card_item_foreign_turn",
      message: "a card item may only quote a turn of its own source.",
    });
  });

  it("INV6-T1: refuses a claim that quotes the other side's turn", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() =>
      asMeeting(t.db, m.meetingId, (trx) =>
        trx
          .insertInto("claims")
          .values({
            meeting_id: m.meetingId,
            step_seq: 1,
            side: "a",
            person_id: m.a.personId,
            position: 1,
            text: "A claim with the wrong quote.",
            quote: at(SEED_TURNS_B, 0),
            lang: "en",
            turn_id: at(m.b.turnIds, 0),
            verified: true,
            flagged: false,
            evidence_valid: false,
          })
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "claim_foreign_turn",
      message: "a claim may only quote a turn of the speaking side's own source.",
    });
  });

  it("INV6-T2: accepts a claim that quotes the speaking side's own turn", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const row = await asMeeting(t.db, m.meetingId, (trx) =>
      trx
        .insertInto("claims")
        .values({
          meeting_id: m.meetingId,
          step_seq: 1,
          side: "a",
          person_id: m.a.personId,
          position: 1,
          text: "A claim with the right quote.",
          quote: at(SEED_TURNS_A, 0),
          lang: "en",
          turn_id: at(m.a.turnIds, 0),
          verified: true,
          flagged: false,
          evidence_valid: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );

    expect(typeof row.id).toBe("string");
  });

  it("INV9-T1: allows each whitelisted meeting transition", async () => {
    const p = await createPairedMeetingWithTurns(t.db);
    const q = await createPairedMeetingWithTurns(t.db);
    const r = await createPairedMeetingWithTurns(t.db);
    const results = [
      await asMeeting(t.db, p.meetingId, (trx) =>
        trx
          .updateTable("meetings")
          .set({ state: "queued" })
          .where("id", "=", p.meetingId)
          .execute(),
      ),
      await asMeeting(t.db, p.meetingId, (trx) =>
        trx
          .updateTable("meetings")
          .set({ state: "running" })
          .where("id", "=", p.meetingId)
          .execute(),
      ),
      await asMeeting(t.db, p.meetingId, (trx) =>
        trx.updateTable("meetings").set({ state: "ended" }).where("id", "=", p.meetingId).execute(),
      ),
      await asMeeting(t.db, p.meetingId, (trx) =>
        trx
          .updateTable("meetings")
          .set({ state: "deleted" })
          .where("id", "=", p.meetingId)
          .execute(),
      ),
      await asMeeting(t.db, q.meetingId, (trx) =>
        trx
          .updateTable("meetings")
          .set({ state: "running" })
          .where("id", "=", q.meetingId)
          .execute(),
      ),
      await asMeeting(t.db, r.meetingId, (trx) =>
        trx
          .updateTable("meetings")
          .set({ state: "deleted" })
          .where("id", "=", r.meetingId)
          .execute(),
      ),
    ];
    const states = await Promise.all(
      [p, q, r].map((meeting) =>
        asMeeting(t.db, meeting.meetingId, (trx) =>
          trx
            .selectFrom("meetings")
            .select("state")
            .where("id", "=", meeting.meetingId)
            .executeTakeFirstOrThrow(),
        ),
      ),
    );

    expect(results.map((row) => row[0]?.numUpdatedRows)).toEqual([1n, 1n, 1n, 1n, 1n, 1n]);
    expect(states.map((row) => row.state)).toEqual(["deleted", "running", "deleted"]);
  });

  it("INV9-T2: refuses every transition off the whitelist", async () => {
    const meetings = await Promise.all(
      Array.from({ length: 5 }, () => createPairedMeetingWithTurns(t.db)),
    );
    const [fresh, queued, running, ended, deleted] = meetings as [
      SeededMeeting,
      SeededMeeting,
      SeededMeeting,
      SeededMeeting,
      SeededMeeting,
    ];
    await setMeetingState(t.db, queued.meetingId, "queued");
    await setMeetingState(t.db, running.meetingId, "running");
    await setMeetingState(t.db, ended.meetingId, "running");
    await setMeetingState(t.db, ended.meetingId, "ended");
    await setMeetingState(t.db, deleted.meetingId, "deleted");
    const pairs: Array<
      [
        SeededMeeting,
        "ready" | "queued" | "running" | "ended" | "deleted",
        "ready" | "queued" | "running" | "ended" | "deleted",
      ]
    > = [
      [fresh, "ready", "ended"],
      [queued, "queued", "ready"],
      [queued, "queued", "ended"],
      [running, "running", "ready"],
      [running, "running", "queued"],
      [ended, "ended", "ready"],
      [ended, "ended", "queued"],
      [ended, "ended", "running"],
      [deleted, "deleted", "ready"],
    ];
    const refusals: unknown[] = [];
    for (const [meeting, from, to] of pairs) {
      refusals.push(await caughtFrom(() => setMeetingState(t.db, meeting.meetingId, to)));
      const read = await asMeeting(t.db, meeting.meetingId, (trx) =>
        trx
          .selectFrom("meetings")
          .select("state")
          .where("id", "=", meeting.meetingId)
          .executeTakeFirstOrThrow(),
      );
      expect(read.state).toBe(from);
    }

    expect(refusals.map((error) => parseDatabaseError(error))).toEqual(
      pairs.map(([, from, to]) => ({
        code: "meeting_bad_transition",
        message: `a meeting cannot go from ${from} to ${to}.`,
      })),
    );
  });

  it("INV9-T3: refuses a prefix change once the meeting is running", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const worker = makeDatabase(t.workerUrl, 1);
    try {
      await asMeeting(worker, m.meetingId, (trx) =>
        trx
          .updateTable("meeting_members")
          .set({ frozen_prefix: "prefix one" })
          .where("meeting_id", "=", m.meetingId)
          .where("side", "=", "a")
          .execute(),
      );
      await setMeetingState(t.db, m.meetingId, "running");
      const error = await caughtFrom(() =>
        asMeeting(worker, m.meetingId, (trx) =>
          trx
            .updateTable("meeting_members")
            .set({ frozen_prefix: "prefix two" })
            .where("meeting_id", "=", m.meetingId)
            .where("side", "=", "a")
            .execute(),
        ),
      );

      expect(parseDatabaseError(error)).toEqual({
        code: "prefix_frozen",
        message: "the prompt prefix cannot change once the meeting is running (D41).",
      });
    } finally {
      await worker.destroy();
    }
  });

  it("INV9-T4: refuses a prefix change after the meeting ended", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const worker = makeDatabase(t.workerUrl, 1);
    try {
      await setMeetingState(t.db, m.meetingId, "running");
      await setMeetingState(t.db, m.meetingId, "ended");
      const error = await caughtFrom(() =>
        asMeeting(worker, m.meetingId, (trx) =>
          trx
            .updateTable("meeting_members")
            .set({ frozen_prefix: "prefix three" })
            .where("meeting_id", "=", m.meetingId)
            .where("side", "=", "a")
            .execute(),
        ),
      );

      expect(parseDatabaseError(error)).toEqual({
        code: "prefix_frozen",
        message: "the prompt prefix cannot change once the meeting is running (D41).",
      });
    } finally {
      await worker.destroy();
    }
  });

  it("INV11-T1: refuses an event seq that skips one", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await asMeeting(t.db, m.meetingId, (trx) =>
      trx
        .insertInto("meeting_events")
        .values({ meeting_id: m.meetingId, seq: 1, type: "meeting.started", v: 1, payload: "{}" })
        .execute(),
    );
    const error = await caughtFrom(() =>
      asMeeting(t.db, m.meetingId, (trx) =>
        trx
          .insertInto("meeting_events")
          .values({ meeting_id: m.meetingId, seq: 3, type: "phase.changed", v: 1, payload: "{}" })
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "event_seq_gap",
      message:
        "expected seq 2 for this meeting, got 3. Re-read max(seq) inside the same transaction.",
    });
  });

  it("INV11-T2: refuses a repeated event seq", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await asMeeting(t.db, m.meetingId, (trx) =>
      trx
        .insertInto("meeting_events")
        .values({ meeting_id: m.meetingId, seq: 1, type: "meeting.started", v: 1, payload: "{}" })
        .execute(),
    );
    const error = await caughtFrom(() =>
      asMeeting(t.db, m.meetingId, (trx) =>
        trx
          .insertInto("meeting_events")
          .values({ meeting_id: m.meetingId, seq: 1, type: "hold", v: 1, payload: "{}" })
          .execute(),
      ),
    );

    expect(parseDatabaseError(error)).toEqual({
      code: "event_seq_gap",
      message:
        "expected seq 2 for this meeting, got 1. Re-read max(seq) inside the same transaction.",
    });
  });

  it("INV11-T3: nextEventSeq counts from 1 and appendMeetingEvent writes at the next seq", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const now = new Date().toISOString();
    const seqs = await asMeeting(t.db, m.meetingId, async (trx) => {
      const s0 = await nextEventSeq(trx, m.meetingId);
      const a1 = await appendMeetingEvent(trx, m.meetingId, {
        v: 1,
        meetingId: m.meetingId,
        at: now,
        type: "phase.changed",
        phase: "open",
        stepSeq: 1,
      });
      const s1 = await nextEventSeq(trx, m.meetingId);
      const a2 = await appendMeetingEvent(trx, m.meetingId, {
        v: 1,
        meetingId: m.meetingId,
        at: now,
        type: "hold",
        stepSeq: 1,
        side: "a",
        reason: "no explicit decision",
      });
      const s2 = await nextEventSeq(trx, m.meetingId);
      return [s0, a1, s1, a2, s2];
    });
    const rows = await asMeeting(t.db, m.meetingId, (trx) =>
      trx
        .selectFrom("meeting_events")
        .select(["type", "v"])
        .where("meeting_id", "=", m.meetingId)
        .orderBy("seq")
        .execute(),
    );

    expect(seqs).toEqual([1, 1, 2, 2, 3]);
    expect(rows).toEqual([
      { type: "phase.changed", v: 1 },
      { type: "hold", v: 1 },
    ]);
  });

  it("INV11-T4: nextEventSeq refuses a meeting this context cannot see", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const n = await createPairedMeetingWithTurns(t.db);
    const error = await caughtFrom(() =>
      asMeeting(t.db, m.meetingId, (trx) => nextEventSeq(trx, n.meetingId)),
    );

    expect(error).toBeInstanceOf(ContractError);
    expect(Reflect.get(error ?? {}, "code")).toBe("not_found");
    expect(Reflect.get(error ?? {}, "httpStatus")).toBe(404);
  });

  it("INV11-T5: two writers on one meeting take seq 1 and 2", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const write = (holdMs: number) =>
      asMeeting(t.db, m.meetingId, async (trx: DatabaseTransaction) => {
        const seq = await nextEventSeq(trx, m.meetingId);
        await sleep(holdMs);
        await trx
          .insertInto("meeting_events")
          .values({ meeting_id: m.meetingId, seq, type: "hold", v: 1, payload: "{}" })
          .execute();
        return seq;
      });

    const seqs = await Promise.all([write(200), write(0)]);
    const rows = await asMeeting(t.db, m.meetingId, (trx) =>
      trx
        .selectFrom("meeting_events")
        .select("seq")
        .where("meeting_id", "=", m.meetingId)
        .execute(),
    );

    expect([...seqs].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(rows).toHaveLength(2);
  });

  it("INV11-T6: appendMeetingEvent refuses turn.delta", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const now = new Date().toISOString();
    const error = await caughtFrom(() =>
      asMeeting(t.db, m.meetingId, (trx) =>
        appendMeetingEvent(trx, m.meetingId, {
          v: 1,
          meetingId: m.meetingId,
          at: now,
          type: "turn.delta",
          stepSeq: 1,
          attempt: 1,
          side: "a",
          offset: 0,
          text: "x",
        }),
      ),
    );
    const rows = await asMeeting(t.db, m.meetingId, (trx) =>
      trx
        .selectFrom("meeting_events")
        .select("seq")
        .where("meeting_id", "=", m.meetingId)
        .execute(),
    );

    expect(error).toBeInstanceOf(ContractError);
    expect(Reflect.get(error ?? {}, "code")).toBe("event_type_unknown");
    expect(Reflect.get(error ?? {}, "httpStatus")).toBe(500);
    expect(rows).toHaveLength(0);
  });

  it("INV11-T7: each committed event wakes the meeting_events channel", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const listener = new pg.Client({ connectionString: t.apiUrl });
    await listener.connect();
    try {
      await listener.query("LISTEN meeting_events");
      const received = new Promise<string>((resolve) => {
        listener.on("notification", (message) => {
          if (message.payload?.startsWith(`e:${m.meetingId}:`) === true) resolve(message.payload);
        });
      });
      const now = new Date().toISOString();
      await asMeeting(t.db, m.meetingId, (trx) =>
        appendMeetingEvent(trx, m.meetingId, startedEvent(m.meetingId, now)),
      );
      const timeout = new Promise<never>((resolve, reject) => {
        setTimeout(() => {
          reject(new Error("no notification within 2000 ms"));
        }, 2_000);
      });

      expect(await Promise.race([received, timeout])).toBe(`e:${m.meetingId}:1`);
    } finally {
      await listener.end();
    }
  });
});
