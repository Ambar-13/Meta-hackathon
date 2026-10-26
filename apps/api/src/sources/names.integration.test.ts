import { createHash } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorBody, NamesReviewResponse, routes, SourceView } from "@meet-first/contracts";
import { makeDatabase, parseDatabaseError, withPerson, type Database } from "@meet-first/db";
import { asPerson, createTestPerson, readTestDatabaseUrls } from "@meet-first/db/testing";
import { normQuote } from "@meet-first/receipts";
import { makePlaceholderCounter } from "@meet-first/scrub";
import { buildTestApp } from "../testing/index.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerSourcesRoutes } from "./index.js";

// The origin every request of this file carries, the same one the test app allows.
const ORIGIN = "http://localhost:3000";

// One name the names pass writes for a test: its text, its role token and whether it is a minor's name.
type NameInput = { text: string; roleToken: string; isMinor?: boolean };

let testApp: Awaited<ReturnType<typeof buildTestApp>>;
let worker: Kysely<Database>;
beforeAll(async () => {
  testApp = await buildTestApp({ routes: [registerSourcesRoutes], env: { APP_ORIGIN: ORIGIN } });
  worker = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, 1);
});

afterAll(async () => {
  await worker.destroy();
  await testApp.close();
});

// A new person for one test, so no two tests share a source list.
async function newPerson(): Promise<{ personId: string; sessionToken: string }> {
  return createTestPerson(testApp.db, "Asha Rao");
}

// Writes one source with these turns for the person, as an upload would (D8, D1).
async function insertSource(personId: string, texts: string[]): Promise<string> {
  return asPerson(testApp.db, personId, async (trx) => {
    const values = {
      person_id: personId, kind: "paste" as const, content_hash: createHash("sha256").update(JSON.stringify(texts)).digest(), turn_count: texts.length,
      canonical_chars: texts.reduce((sum, text) => sum + text.length, 0), persona_signal: 0.5, parser_version: "1", scrub_version: "1", attested_at: new Date(),
    };
    const source = await trx.insertInto("sources").values(values).returning("id").executeTakeFirstOrThrow();
    const rows = texts.map((text, index) => ({ source_id: source.id, person_id: personId, turn_index: index, role: "user" as const, text, norm_text: normQuote(text), lang: "en" }));
    await trx.insertInto("turns").values(rows).execute();
    return source.id;
  });
}

// Writes the rows the names pass leaves for a source, as the worker's job does (ingest spec 4.3.7): each name is replaced with its
// role token in every turn, one redaction is written per occurrence, one names row per name, and the names_passes row last.
async function writeNamesPassRows(personId: string, sourceId: string, names: NameInput[]): Promise<void> {
  await withPerson(worker, personId, async (trx) => {
    const turns = (await trx.selectFrom("turns").select(["id", "text"]).where("source_id", "=", sourceId).orderBy("turn_index").execute()).map((row) => ({ ...row }));
    const existing = await trx.selectFrom("redactions").select("placeholder_id").where("source_id", "=", sourceId).execute();
    const highest = existing.reduce((max, row) => Math.max(max, parseInt(row.placeholder_id, 16)), 0);
    const next = makePlaceholderCounter(highest + 1);
    for (const name of names) {
      const placeholderIds: string[] = [];
      for (const turn of turns) {
        const count = turn.text.split(name.text).length - 1;
        if (count === 0) continue;
        turn.text = turn.text.split(name.text).join(name.roleToken);
        await trx.updateTable("turns").set({ text: turn.text, norm_text: normQuote(turn.text) }).where("id", "=", turn.id).execute();
        for (let occurrence = 0; occurrence < count; occurrence += 1) {
          const placeholderId = next();
          placeholderIds.push(placeholderId);
          await trx.insertInto("redactions").values({ source_id: sourceId, turn_id: turn.id, person_id: personId, category: "person", placeholder_id: placeholderId }).execute();
        }
      }
      await trx.insertInto("source_names").values({ source_id: sourceId, person_id: personId, text: name.text, role_token: name.roleToken, is_minor: name.isMinor ?? false, placeholder_ids: placeholderIds }).execute();
    }
    await trx.insertInto("names_passes").values({ source_id: sourceId, person_id: personId }).execute();
  });
}

// Reads a source's view as the caller, with an optional query string.
function read(token: string, sourceId: string, query = ""): Promise<LightMyRequestResponse> {
  return testApp.app.inject({ method: "GET", url: routes.sources.readSource.path.replace(":id", sourceId) + query, headers: sessionHeader(token) });
}

// Posts a names review for a source as the caller.
function review(token: string, sourceId: string, body: unknown): Promise<LightMyRequestResponse> {
  return testApp.app.inject({ method: "POST", url: routes.sources.namesReview.path.replace(":id", sourceId), headers: { ...sessionHeader(token), "content-type": "application/json" }, payload: JSON.stringify(body) });
}

// The source row as the person sees it, for checks on the freeze and the opt-ins.
async function sourceRow(personId: string, sourceId: string) {
  return asPerson(testApp.db, personId, (trx) => trx.selectFrom("sources").selectAll().where("id", "=", sourceId).executeTakeFirstOrThrow());
}

// The stored text of every turn of a source, in turn order.
async function turnTexts(personId: string, sourceId: string): Promise<string[]> {
  const rows = await asPerson(testApp.db, personId, (trx) => trx.selectFrom("turns").select("text").where("source_id", "=", sourceId).orderBy("turn_index").execute());
  return rows.map((row) => row.text);
}

// How many rows one table holds for a source, counted as the person.
async function rowsIn(personId: string, table: "source_names" | "names_passes", sourceId: string): Promise<number> {
  const counted = await asPerson(testApp.db, personId, (trx) => trx.selectFrom(table).select((eb) => eb.fn.countAll().as("count")).where("source_id", "=", sourceId).executeTakeFirstOrThrow());
  return Number(counted.count);
}

describe("GET /api/sources/:id", () => {
  it("R2.4-T1: names come 20 a page, ordered by role token, every keep false", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["nothing to see here"]);
    const names = Array.from({ length: 45 }, (entry, index) => ({ text: `Person ${String(index + 1).padStart(2, "0")}`, roleToken: `[person:friend ${String(index + 1).padStart(2, "0")}]` }));
    await writeNamesPassRows(person.personId, sourceId, names);
    const first = SourceView.parse((await read(person.sessionToken, sourceId)).json());
    expect(first.names.total).toBe(45);
    expect(first.names.pageSize).toBe(20);
    expect(first.names.rows.length).toBe(20);
    expect(first.names.rows[0]).toEqual({ text: "Person 01", roleToken: "[person:friend 01]", context: "[person:friend 01]", keep: false });
    expect(first.names.rows[19]?.roleToken).toBe("[person:friend 20]");
    expect(first.names.rows.every((row) => !row.keep)).toBe(true);
    const third = SourceView.parse((await read(person.sessionToken, sourceId, "?page=3")).json());
    expect(third.names.rows.length).toBe(5);
    expect(third.names.rows[0]?.roleToken).toBe("[person:friend 41]");
    const fourth = SourceView.parse((await read(person.sessionToken, sourceId, "?page=4")).json());
    expect(fourth.names.rows.length).toBe(0);
    expect(fourth.names.total).toBe(45);
  });

  it("R2.3-T1: a name's context is up to 3 words each side, with its role token in place of the name", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["We met Rohan Mehta at the station near the old market yesterday."]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Rohan Mehta", roleToken: "[person:colleague]" }]);
    const view = SourceView.parse((await read(person.sessionToken, sourceId)).json());
    expect(view.names.rows).toEqual([{ text: "Rohan Mehta", roleToken: "[person:colleague]", context: "We met [person:colleague] at the station", keep: false }]);
    expect(view.redactionCount).toBe(1);
    expect(view.namesPassDone).toBe(true);
  });

  it("D18-T1: a minor's name is never listed", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Anya and Rohan Mehta came over."]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Anya", roleToken: "[person:daughter]", isMinor: true }, { text: "Rohan Mehta", roleToken: "[person:colleague]" }]);
    const view = SourceView.parse((await read(person.sessionToken, sourceId)).json());
    expect(view.names.total).toBe(1);
    expect(view.names.rows[0]?.text).toBe("Rohan Mehta");
    expect(view.redactionCount).toBe(2);
  });

  it("R2.4-T2: before the names pass finishes the list is empty", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Nothing has been checked yet."]);
    const view = SourceView.parse((await read(person.sessionToken, sourceId)).json());
    expect(view.namesPassDone).toBe(false);
    expect(view.names.total).toBe(0);
    expect(view.names.rows).toEqual([]);
    expect(view.frozenAt).toBeNull();
    expect(view.namesReviewedAt).toBeNull();
    expect(view.redactionCount).toBe(0);
    expect(view.kind).toBe("paste");
    expect(view.personaSignal).toBe(0.5);
    expect(view.turnCount).toBe(1);
    expect(Number.isNaN(Date.parse(view.serverNow))).toBe(false);
  });

  it("R2.4-T3: another person's source and a bad id are not_found, and page 0 is payload_invalid", async () => {
    const owner = await newPerson();
    const other = await newPerson();
    const sourceId = await insertSource(owner.personId, ["Owned by the first person."]);
    const foreign = await read(other.sessionToken, sourceId);
    expect(foreign.statusCode).toBe(404);
    expect(ErrorBody.parse(foreign.json()).code).toBe("not_found");
    const badId = await read(owner.sessionToken, "not-a-uuid");
    expect(badId.statusCode).toBe(404);
    expect(ErrorBody.parse(badId.json()).code).toBe("not_found");
    const pageZero = await read(owner.sessionToken, sourceId, "?page=0");
    expect(pageZero.statusCode).toBe(400);
    expect(ErrorBody.parse(pageZero.json()).code).toBe("payload_invalid");
  });
});

describe("POST /api/sources/:id/names-review", () => {
  it("D15-T2: a review before the names pass finished is refused", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["No names check has run yet."]);
    const reply = await review(person.sessionToken, sourceId, { decisions: [], sensitiveOptIn: [] });
    expect(reply.statusCode).toBe(409);
    expect(ErrorBody.parse(reply.json()).code).toBe("names_pass_running");
    expect((await sourceRow(person.personId, sourceId)).frozen_at).toBeNull();
  });

  it("D16-T1: a review freezes the source and answers with COUNT(*) of redactions", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["We met Rohan Mehta at the station.", "Rohan Mehta called again."]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Rohan Mehta", roleToken: "[person:colleague]" }]);
    const reply = await review(person.sessionToken, sourceId, { decisions: [{ text: "Rohan Mehta", keep: false }], sensitiveOptIn: [] });
    expect(reply.statusCode).toBe(200);
    const answer = NamesReviewResponse.parse(reply.json());
    expect(answer.redactionCount).toBe(2);
    const row = await sourceRow(person.personId, sourceId);
    expect(row.frozen_at).not.toBeNull();
    expect(row.frozen_at?.getTime()).toBe(row.names_reviewed_at?.getTime());
    expect(answer.frozenAt).toBe(row.frozen_at?.toISOString());
    expect(await turnTexts(person.personId, sourceId)).toEqual(["We met [person:colleague] at the station.", "[person:colleague] called again."]);
    expect(await rowsIn(person.personId, "source_names", sourceId)).toBe(0);
    expect(await rowsIn(person.personId, "names_passes", sourceId)).toBe(1);
  });

  it("R2.3-T2: after the names pass rows and a review, the third-party name is gone and the display name stays", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Asha Rao met Rohan Mehta at the cafe."]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Rohan Mehta", roleToken: "[person:colleague]" }]);
    await review(person.sessionToken, sourceId, { decisions: [], sensitiveOptIn: [] });
    expect(await turnTexts(person.personId, sourceId)).toEqual(["Asha Rao met [person:colleague] at the cafe."]);
  });

  it("R2.4-T4: keeping a name puts it back and removes its redaction rows", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Ask Tom about the plan.", "Tom said yes.", "Priya cooked."]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Tom", roleToken: "[person:manager]" }, { text: "Priya", roleToken: "[person:friend]" }]);
    const reply = await review(person.sessionToken, sourceId, { decisions: [{ text: "Tom", keep: true }], sensitiveOptIn: [] });
    expect(NamesReviewResponse.parse(reply.json()).redactionCount).toBe(1);
    expect(await turnTexts(person.personId, sourceId)).toEqual(["Ask Tom about the plan.", "Tom said yes.", "[person:friend] cooked."]);
    const rows = await asPerson(testApp.db, person.personId, (trx) => trx.selectFrom("turns").select(["text", "norm_text"]).where("source_id", "=", sourceId).orderBy("turn_index").execute());
    expect(rows.map((row) => row.norm_text)).toEqual(rows.map((row) => normQuote(row.text)));
    const left = await asPerson(testApp.db, person.personId, (trx) => trx.selectFrom("redactions").select("placeholder_id").where("source_id", "=", sourceId).execute());
    expect(left.map((row) => row.placeholder_id)).toEqual(["00000003"]);
  });

  it("R2.4-T5: a name with no decision stays replaced", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Ask Tom about the plan.", "Tom said yes.", "Priya cooked."]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Tom", roleToken: "[person:manager]" }, { text: "Priya", roleToken: "[person:friend]" }]);
    const reply = await review(person.sessionToken, sourceId, { decisions: [{ text: "Priya", keep: true }], sensitiveOptIn: [] });
    expect(NamesReviewResponse.parse(reply.json()).redactionCount).toBe(2);
    expect(await turnTexts(person.personId, sourceId)).toEqual(["Ask [person:manager] about the plan.", "[person:manager] said yes.", "Priya cooked."]);
  });

  it("D18-T2: sensitive opt-ins are stored once each, and a category outside the list is refused", async () => {
    const person = await newPerson();
    const first = await insertSource(person.personId, ["Opt in one."]);
    await writeNamesPassRows(person.personId, first, []);
    const kept = await review(person.sessionToken, first, { decisions: [], sensitiveOptIn: ["health", "health", "minor"] });
    expect(kept.statusCode).toBe(200);
    expect((await sourceRow(person.personId, first)).sensitive_opt_in).toEqual(["health", "minor"]);
    const second = await insertSource(person.personId, ["Opt in two."]);
    await writeNamesPassRows(person.personId, second, []);
    const refused = await review(person.sessionToken, second, { decisions: [], sensitiveOptIn: ["email"] });
    expect(refused.statusCode).toBe(422);
    expect(ErrorBody.parse(refused.json()).code).toBe("sensitive_category_invalid");
    expect((await sourceRow(person.personId, second)).frozen_at).toBeNull();
  });

  it("D16-T2: a second review is refused", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Frozen once only."]);
    await writeNamesPassRows(person.personId, sourceId, []);
    const body = { decisions: [], sensitiveOptIn: [] };
    expect((await review(person.sessionToken, sourceId, body)).statusCode).toBe(200);
    const again = await review(person.sessionToken, sourceId, body);
    expect(again.statusCode).toBe(409);
    expect(ErrorBody.parse(again.json()).code).toBe("source_already_frozen");
  });

  it("R2.9-T2: after the freeze, changing a turn's text raises turn_text_frozen", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Changed after the freeze."]);
    await writeNamesPassRows(person.personId, sourceId, []);
    expect((await review(person.sessionToken, sourceId, { decisions: [], sensitiveOptIn: [] })).statusCode).toBe(200);
    let thrown: unknown;
    await asPerson(testApp.db, person.personId, (trx) => trx.updateTable("turns").set({ text: "changed" }).where("source_id", "=", sourceId).execute()).catch((error: unknown) => {
      thrown = error;
    });
    expect(parseDatabaseError(thrown)?.code).toBe("turn_text_frozen");
  });

  it("R2.4-T6: an unknown name, a minor's name and a repeated name are refused", async () => {
    const person = await newPerson();
    const sourceId = await insertSource(person.personId, ["Tom and Anya walked."]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Tom", roleToken: "[person:manager]" }, { text: "Anya", roleToken: "[person:daughter]", isMinor: true }]);
    const unknown = await review(person.sessionToken, sourceId, { decisions: [{ text: "Nobody", keep: true }], sensitiveOptIn: [] });
    expect(unknown.statusCode).toBe(422);
    expect(ErrorBody.parse(unknown.json()).code).toBe("names_review_unknown_name");
    const minor = await review(person.sessionToken, sourceId, { decisions: [{ text: "Anya", keep: true }], sensitiveOptIn: [] });
    expect(minor.statusCode).toBe(422);
    expect(ErrorBody.parse(minor.json()).code).toBe("names_review_unknown_name");
    const repeated = await review(person.sessionToken, sourceId, { decisions: [{ text: "Tom", keep: true }, { text: "Tom", keep: false }], sensitiveOptIn: [] });
    expect(repeated.statusCode).toBe(400);
    expect(ErrorBody.parse(repeated.json()).code).toBe("payload_invalid");
    expect((await sourceRow(person.personId, sourceId)).frozen_at).toBeNull();
  });

  it("R2.4-T7: putting back a name that would make a turn longer than 20,000 characters is refused", async () => {
    const person = await newPerson();
    const text = "x".repeat(19_989) + " [person:a]";
    const sourceId = await insertSource(person.personId, [text]);
    await writeNamesPassRows(person.personId, sourceId, [{ text: "Bartholomew", roleToken: "[person:a]" }]);
    const reply = await review(person.sessionToken, sourceId, { decisions: [{ text: "Bartholomew", keep: true }], sensitiveOptIn: [] });
    expect(reply.statusCode).toBe(422);
    expect(ErrorBody.parse(reply.json()).code).toBe("names_review_turn_too_long");
    expect(await turnTexts(person.personId, sourceId)).toEqual([text]);
    expect((await sourceRow(person.personId, sourceId)).frozen_at).toBeNull();
  });
});
