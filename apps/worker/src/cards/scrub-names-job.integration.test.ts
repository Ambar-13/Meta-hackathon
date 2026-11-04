import { createHash, randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContractError, PLACEHOLDER_PATTERN } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, withPerson, type Database } from "@meet-first/db";
import {
  asPerson,
  createTestPerson,
  freshTestDatabase,
  type TestDatabase,
} from "@meet-first/db/testing";
import { normQuote } from "@meet-first/receipts";
import { LimiterBusy, readLedgerWindow } from "@meet-first/llm";
import {
  makeTestJobContext,
  namesCase,
  runJobOnce,
  type NamesFixtureCase,
} from "../testing/index.js";

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

// The ids a seeded names case gives its person, its source and its turns, in turn_index order.
type Seeded = { personId: string; sourceId: string; turnIds: string[] };

// Writes one ledger row per entry for the person, through the worker, with the dollars and the
// start the test gives.
async function insertLedgerRows(
  personId: string,
  rows: Array<{
    estTokens: number;
    usd?: number;
    startedAt?: Date;
    callSite?: "card" | "scrub_names";
  }>,
): Promise<void> {
  await asPerson(workerDb, personId, (trx) =>
    trx
      .insertInto("ledger")
      .values(
        rows.map((row) => ({
          person_id: personId,
          call_site: row.callSite ?? "card",
          model: "muse-spark-1.3",
          effort: "medium" as const,
          est_tokens: row.estTokens,
          usd: row.usd ?? 0,
          status: "ok" as const,
          llm_mode: "replay" as const,
          ...(row.startedAt === undefined ? {} : { started_at: row.startedAt }),
        })),
      )
      .execute(),
  );
}

// Seeds one names case: the person, the affiliations, an unfrozen source with its turns and the
// redactions the upload left.
async function seedNamesCase(
  fixtureCase: NamesFixtureCase,
  options: { isFrozen?: boolean } = {},
): Promise<Seeded> {
  const person = await createTestPerson(fresh.db, fixtureCase.displayName);
  if (fixtureCase.affiliations.length > 0) {
    await asPerson(fresh.db, person.personId, (trx) =>
      trx
        .updateTable("people")
        .set({ affiliations: [...fixtureCase.affiliations] })
        .where("id", "=", person.personId)
        .execute(),
    );
  }
  const personId = person.personId;
  const inserted = await asPerson(fresh.db, personId, async (trx) => {
    const source = await trx
      .insertInto("sources")
      .values({
        person_id: personId,
        kind: "paste",
        content_hash: createHash("sha256").update(randomUUID()).digest(),
        turn_count: fixtureCase.turns.length,
        canonical_chars: fixtureCase.turns.reduce((sum, text) => sum + text.length, 0),
        persona_signal: "0.500",
        parser_version: "1",
        scrub_version: "1",
        attested_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const turns = await trx
      .insertInto("turns")
      .values(
        fixtureCase.turns.map((text, index) => ({
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
    const redactions = turns.flatMap((turn) =>
      [...(fixtureCase.turns[turn.turn_index] ?? "").matchAll(PLACEHOLDER_PATTERN)].map(
        (match) => ({
          source_id: source.id,
          turn_id: turn.id,
          person_id: personId,
          category: match[1] ?? "",
          placeholder_id: match[2] ?? "",
        }),
      ),
    );
    if (redactions.length > 0) await trx.insertInto("redactions").values(redactions).execute();
    return {
      sourceId: source.id,
      turnIds: turns.sort((a, b) => a.turn_index - b.turn_index).map((turn) => turn.id),
    };
  });
  if (options.isFrozen === true) await freezeSource(personId, inserted.sourceId);
  return { personId, sourceId: inserted.sourceId, turnIds: inserted.turnIds };
}

// Freezes a source the way the names review does: the names pass row first, through the worker,
// then the freeze, then the pass row is removed so the job sees a frozen source with no pass.
async function freezeSource(personId: string, sourceId: string): Promise<void> {
  await withPerson(workerDb, personId, (trx) =>
    trx.insertInto("names_passes").values({ source_id: sourceId, person_id: personId }).execute(),
  );
  const now = new Date();
  await asPerson(fresh.db, personId, (trx) =>
    trx
      .updateTable("sources")
      .set({ names_reviewed_at: now, frozen_at: now })
      .where("id", "=", sourceId)
      .execute(),
  );
  await withPerson(workerDb, personId, (trx) =>
    trx.deleteFrom("names_passes").where("source_id", "=", sourceId).execute(),
  );
}

// The turns of a source as the job left them, in turn order.
async function readTurns(
  seeded: Seeded,
): Promise<Array<{ text: string; norm_text: string; sensitive_categories: string[] }>> {
  return asPerson(workerDb, seeded.personId, (trx) =>
    trx
      .selectFrom("turns")
      .select(["text", "norm_text", "sensitive_categories"])
      .where("source_id", "=", seeded.sourceId)
      .orderBy("turn_index", "asc")
      .execute(),
  );
}

// The redaction rows of a source, ordered by category and id.
async function readRedactions(
  seeded: Seeded,
): Promise<Array<{ turn_id: string; category: string; placeholder_id: string }>> {
  return asPerson(workerDb, seeded.personId, (trx) =>
    trx
      .selectFrom("redactions")
      .select(["turn_id", "category", "placeholder_id"])
      .where("source_id", "=", seeded.sourceId)
      .orderBy("category")
      .orderBy("placeholder_id")
      .execute(),
  );
}

// The names rows of a source, ordered by role token.
async function readNames(
  seeded: Seeded,
): Promise<
  Array<{ text: string; role_token: string; is_minor: boolean; placeholder_ids: string[] }>
> {
  return asPerson(workerDb, seeded.personId, (trx) =>
    trx
      .selectFrom("source_names")
      .select(["text", "role_token", "is_minor", "placeholder_ids"])
      .where("source_id", "=", seeded.sourceId)
      .orderBy("role_token")
      .execute(),
  );
}

// The names pass rows of a source.
async function readPasses(seeded: Seeded): Promise<Array<{ source_id: string }>> {
  return asPerson(workerDb, seeded.personId, (trx) =>
    trx
      .selectFrom("names_passes")
      .select("source_id")
      .where("source_id", "=", seeded.sourceId)
      .execute(),
  );
}

// The ledger rows of the person, in start order.
async function ledgerRows(
  seeded: Seeded,
): Promise<Array<{ call_site: string; status: string; llm_mode: string }>> {
  return asPerson(workerDb, seeded.personId, (trx) =>
    trx
      .selectFrom("ledger")
      .select(["call_site", "status", "llm_mode"])
      .orderBy("started_at")
      .orderBy("id")
      .execute(),
  );
}

// The texts of a names case, in turn order, as the seed stored them.
function caseTexts(name: string): string[] {
  return [...namesCase(name).turns];
}

describe("the names pass job", () => {
  it("R2.3-T9: the names pass writes the role token, the name's row and the pass row, and leaves the person's own name even when the model returns it", async () => {
    const seeded = await seedNamesCase(namesCase("names-allowlist"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    const texts = caseTexts("names-allowlist");
    const turns = await readTurns(seeded);
    expect(turns[0]?.text).toBe(
      "I asked [person:colleague] to look over my plan before Friday, and she found two gaps.",
    );
    expect(turns[0]?.norm_text).toBe(normQuote(turns[0]?.text ?? ""));
    expect(turns[1]?.text).toBe(texts[1]);
    expect(turns[2]?.text).toBe(texts[2]);
    expect(await readRedactions(seeded)).toEqual([
      { turn_id: seeded.turnIds[0], category: "person", placeholder_id: "00000001" },
    ]);
    expect(await readNames(seeded)).toEqual([
      {
        text: "Priya Nair",
        role_token: "[person:colleague]",
        is_minor: false,
        placeholder_ids: ["00000001"],
      },
    ]);
    expect(await readPasses(seeded)).toHaveLength(1);
    expect(await ledgerRows(seeded)).toEqual([
      { call_site: "scrub_names", status: "ok", llm_mode: "replay" },
    ]);
  });

  it("D18-T2: a child's name gets the child token, an is_minor row and the minor tag, and its id continues the source's counter", async () => {
    const seeded = await seedNamesCase(namesCase("names-minor-and-placeholders"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    const turns = await readTurns(seeded);
    expect(turns[0]).toMatchObject({
      text: "My daughter [person:child] starts school in June, so I leave work by four every day.",
      sensitive_categories: ["minor"],
    });
    expect(await readNames(seeded)).toEqual([
      {
        text: "Meera",
        role_token: "[person:child]",
        is_minor: true,
        placeholder_ids: ["7b2d4e11"],
      },
    ]);
    expect(await readRedactions(seeded)).toContainEqual({
      turn_id: seeded.turnIds[0],
      category: "person",
      placeholder_id: "7b2d4e11",
    });
  });

  it("R2.8-T2: an address placeholder tags its turn, an email or phone placeholder does not, and the seeded rows stay", async () => {
    const seeded = await seedNamesCase(namesCase("names-minor-and-placeholders"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    const texts = caseTexts("names-minor-and-placeholders");
    const turns = await readTurns(seeded);
    expect(turns[1]?.text).toBe(texts[1]);
    expect(turns[2]?.text).toBe(texts[2]);
    expect(turns[1]?.sensitive_categories).toEqual([]);
    expect(turns[2]?.sensitive_categories).toEqual(["address"]);
    expect(await readRedactions(seeded)).toEqual([
      { turn_id: seeded.turnIds[2], category: "address", placeholder_id: "0c4e8a91" },
      { turn_id: seeded.turnIds[1], category: "email", placeholder_id: "3f9a1c2e" },
      { turn_id: seeded.turnIds[0], category: "person", placeholder_id: "7b2d4e11" },
      { turn_id: seeded.turnIds[1], category: "phone", placeholder_id: "7b2d4e10" },
    ]);
  });

  it("R2.6-T2: a paste with no third-party name takes one call, changes no turn and still gets its pass row", async () => {
    const seeded = await seedNamesCase(namesCase("names-none"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    expect(await ledgerRows(seeded)).toEqual([
      { call_site: "scrub_names", status: "ok", llm_mode: "replay" },
    ]);
    expect((await readTurns(seeded)).map((turn) => turn.text)).toEqual(caseTexts("names-none"));
    expect(await readRedactions(seeded)).toEqual([]);
    expect(await readNames(seeded)).toEqual([]);
    expect(await readPasses(seeded)).toHaveLength(1);
  });

  it("D15-T7: one call per chunk, and a name from the second chunk is replaced only where it occurs", async () => {
    const seeded = await seedNamesCase(namesCase("names-two-chunks"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    const texts = caseTexts("names-two-chunks");
    expect(await ledgerRows(seeded)).toEqual([
      { call_site: "scrub_names", status: "ok", llm_mode: "replay" },
      { call_site: "scrub_names", status: "ok", llm_mode: "replay" },
    ]);
    const turns = await readTurns(seeded);
    expect(turns.slice(0, 5).map((turn) => turn.text)).toEqual(texts.slice(0, 5));
    expect(turns[5]?.text).toBe(texts[5]?.replace("Dana", "[person:colleague]"));
    expect(turns[5]?.text.length).toBe(19_008);
    expect(await readNames(seeded)).toEqual([
      {
        text: "Dana",
        role_token: "[person:colleague]",
        is_minor: false,
        placeholder_ids: ["00000001"],
      },
    ]);
    expect(await readRedactions(seeded)).toEqual([
      { turn_id: seeded.turnIds[5], category: "person", placeholder_id: "00000001" },
    ]);
  });

  it("D15-T8: a second run of the same source makes no call and changes nothing", async () => {
    const seeded = await seedNamesCase(namesCase("names-none"));
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    expect(await ledgerRows(seeded)).toHaveLength(1);
    expect((await readTurns(seeded)).map((turn) => turn.text)).toEqual(caseTexts("names-none"));
    expect(await readPasses(seeded)).toHaveLength(1);
  });

  it("D15-T9: a frozen source is left alone and makes no call", async () => {
    const seeded = await seedNamesCase(namesCase("names-allowlist"), { isFrozen: true });
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await expect(
      runJobOnce(context, "scrub_names", { sourceId: seeded.sourceId, personId: seeded.personId }),
    ).resolves.toBeUndefined();
    expect(await ledgerRows(seeded)).toEqual([]);
    expect((await readTurns(seeded))[0]?.text).toBe(caseTexts("names-allowlist")[0]);
    expect(await readRedactions(seeded)).toEqual([]);
    expect(await readNames(seeded)).toEqual([]);
    expect(await readPasses(seeded)).toEqual([]);
  });

  it("D15-T1: the job reads only as the payload's person, so another person's payload finds no source", async () => {
    const seeded = await seedNamesCase(namesCase("names-allowlist"));
    const other = await createTestPerson(fresh.db, "Other Person");
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    const error = await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: other.personId,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContractError);
    expect(error).toMatchObject({ code: "names_source_missing", httpStatus: 500 });
    expect((await readLedgerWindow(workerDb, 600)).callCount).toBe(0);
    expect((await readTurns(seeded))[0]?.text).toBe(caseTexts("names-allowlist")[0]);
    expect(await readPasses(seeded)).toEqual([]);
  });

  it("D60-T4: the daily cap stops the names pass and enqueues it again one minute after the next UTC midnight (fake clock)", async () => {
    const fixed = new Date("2026-10-27T10:00:00.000Z");
    const seeded = await seedNamesCase(namesCase("names-allowlist"));
    await insertLedgerRows(seeded.personId, [{ estTokens: 1, usd: 40, startedAt: fixed }]);
    const { context, enqueued } = makeTestJobContext({ db: workerDb, now: () => fixed });
    await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    });
    expect(enqueued).toEqual([
      {
        name: "scrub_names",
        payload: { sourceId: seeded.sourceId, personId: seeded.personId },
        options: { runAt: new Date("2026-10-28T00:01:00.000Z") },
      },
    ]);
    expect(await ledgerRows(seeded)).toEqual([
      { call_site: "card", status: "ok", llm_mode: "replay" },
    ]);
    expect((await readTurns(seeded))[0]?.text).toBe(caseTexts("names-allowlist")[0]);
    expect(await readPasses(seeded)).toEqual([]);
  });

  it("R10.6-T2: the total cap stops the names pass with no new job (fake clock)", async () => {
    const seeded = await seedNamesCase(namesCase("names-allowlist"));
    await insertLedgerRows(seeded.personId, [
      { estTokens: 1, usd: 130, startedAt: new Date("2026-10-24T10:00:00.000Z") },
    ]);
    const { context, enqueued } = makeTestJobContext({ db: workerDb, now: () => NOW });
    await expect(
      runJobOnce(context, "scrub_names", { sourceId: seeded.sourceId, personId: seeded.personId }),
    ).resolves.toBeUndefined();
    expect(enqueued).toEqual([]);
    expect((await readTurns(seeded))[0]?.text).toBe(caseTexts("names-allowlist")[0]);
    expect(await readPasses(seeded)).toEqual([]);
  });

  it("D58-T6: a full token window stops the names pass with LimiterBusy and changes nothing", async () => {
    const seeded = await seedNamesCase(namesCase("names-allowlist"));
    await insertLedgerRows(seeded.personId, [
      { estTokens: 1_000_000 },
      { estTokens: 1_000_000 },
      { estTokens: 1_000_000 },
    ]);
    const { context } = makeTestJobContext({ db: workerDb, now: () => NOW });
    const error = await runJobOnce(context, "scrub_names", {
      sourceId: seeded.sourceId,
      personId: seeded.personId,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LimiterBusy);
    expect(error).toMatchObject({ code: "limiter_busy" });
    expect(await ledgerRows(seeded)).toHaveLength(3);
    expect((await readTurns(seeded))[0]?.text).toBe(caseTexts("names-allowlist")[0]);
    expect(await readPasses(seeded)).toEqual([]);
  });
});
