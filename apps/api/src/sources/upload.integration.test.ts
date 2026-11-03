import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { gzipSync } from "node:zlib";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalise } from "@meet-first/parsers";
import { countPlaceholders } from "@meet-first/scrub";
import { normQuote } from "@meet-first/receipts";
import { ErrorBody, routes, SESSION_COOKIE, SourceCreateResponse } from "@meet-first/contracts";
import { makeDatabase, withPerson, type Database } from "@meet-first/db";
import { asPerson, createTestPerson, readTestDatabaseUrls } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { registerSourcesRoutes } from "./index.js";
import { parseSourceBody } from "./ndjson-body.js";
import { storeUpload } from "./upload.js";

// The origin every request of this file carries, the same one the test app allows.
const ORIGIN = "http://localhost:3000";
// The synthetic ChatGPT 2024 mapping export, read once: posted raw as a body it must be refused (D1-T9).
const chatgptRaw = await readFile(new URL("../../../../packages/parsers/fixtures/chatgpt-2024-mapping.json", import.meta.url), "utf8");
// The fenced env file of the scrub fixtures, read once for the fence test (R2.1-T3).
const fencedEnv = await readFile(new URL("../../../../packages/scrub/fixtures/fenced-env.md", import.meta.url), "utf8");

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

// A new person for one test, so the source cap and the duplicates never cross tests.
async function newPerson(): Promise<{ personId: string; sessionToken: string }> {
  return createTestPerson(testApp.db, "Asha Rao");
}

// The body of an upload: a header line, then one turn line per text.
function makeBody(texts: string[], header: Record<string, unknown> = {}): string {
  const headerLine = JSON.stringify({ kind: "paste", parserVersion: "1", scrubVersion: "1", personaSignal: 0.5, attested: true, turnCount: texts.length, ...header });
  const turnLines = texts.map((text, index) => JSON.stringify({ turnIndex: index, role: "user", text, lang: "en", sensitiveCategories: [] }));
  return [headerLine, ...turnLines].join("\n");
}

// The bytes of a gzip body for a text.
function gz(text: string): Buffer {
  return gzipSync(Buffer.from(text, "utf8"));
}

// Posts an upload as one person, with the given Content-Encoding (or none when null).
function post(token: string, body: Buffer, encoding: string | null = "gzip") {
  const encodingHeader = encoding === null ? {} : { "content-encoding": encoding };
  return testApp.app.inject({
    method: "POST",
    url: routes.sources.createSource.path,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: ORIGIN, "content-type": "application/x-ndjson", ...encodingHeader },
    payload: body,
  });
}

// How many sources one person holds, read as that person.
async function countSources(personId: string): Promise<number> {
  return asPerson(testApp.db, personId, async (trx) => {
    const counted = await trx.selectFrom("sources").select((eb) => eb.fn.countAll().as("count")).where("person_id", "=", personId).executeTakeFirstOrThrow();
    return Number(counted.count);
  });
}

// The stored turns of one source, in turn order, read as their person.
async function storedTurns(personId: string, sourceId: string) {
  return asPerson(testApp.db, personId, (trx) =>
    trx.selectFrom("turns").select(["turn_index", "role", "text", "norm_text"]).where("source_id", "=", sourceId).orderBy("turn_index").execute(),
  );
}

// The second and third lines of a three-line upload, swapped, so the turn order is wrong (D4-T12).
function swappedTurnLines(): string {
  const lines = makeBody(["a b", "c d"]).split("\n");
  return [lines[0], lines[2], lines[1]].join("\n");
}

// The uploads the refusal table posts, each with the status and code it must get back.
const refusals: Array<{ name: string; body: () => Buffer; encoding: string | null; status: number; code: string }> = [
  { name: "D4-T7: a gzip body that inflates past 20,971,520 bytes is refused", body: () => gzipSync(Buffer.alloc(20_971_521, 0x61)), encoding: "gzip", status: 413, code: "upload_too_large" },
  { name: "D4-T8: a body over 8,388,608 bytes as sent is refused", body: () => randomBytes(8_388_609), encoding: "gzip", status: 413, code: "upload_too_large" },
  { name: "D4-T9: a body that says gzip and is not is refused", body: () => Buffer.from(makeBody(["x y"])), encoding: "gzip", status: 400, code: "upload_not_gzip" },
  { name: "D4-T10: an unknown Content-Encoding is refused", body: () => Buffer.from(makeBody(["x y"])), encoding: "br", status: 400, code: "upload_encoding_unsupported" },
  { name: "R1.7-T2: a header announcing 10,001 turns is refused", body: () => gz(makeBody(["one"], { turnCount: 10001 })), encoding: "gzip", status: 413, code: "source_too_many_turns" },
  { name: "R1.7-T3: 10,001 turn lines are refused even when the header says 10,000", body: () => gz(makeBody(Array.from({ length: 10001 }, (entry, index) => "note " + String(index)), { turnCount: 10000 })), encoding: "gzip", status: 413, code: "source_too_many_turns" },
  { name: "D9-T4: a header with turnCount 0 is refused on the server too", body: () => gz(JSON.stringify({ kind: "paste", parserVersion: "1", scrubVersion: "1", personaSignal: 0.5, attested: true, turnCount: 0 })), encoding: "gzip", status: 422, code: "source_no_own_turns" },
  { name: "R2.7-T1: an upload that was not attested is refused", body: () => gz(makeBody(["x y"], { attested: false })), encoding: "gzip", status: 422, code: "source_not_attested" },
  { name: "D4-T11: a line count that disagrees with turnCount is refused", body: () => gz(makeBody(["a", "b"], { turnCount: 3 })), encoding: "gzip", status: 422, code: "source_turn_count_mismatch" },
  { name: "D5-T10: a turn over 20,000 characters is refused", body: () => gz(makeBody(["a".repeat(20001)])), encoding: "gzip", status: 400, code: "payload_invalid" },
  { name: "D1-T9: a raw export posted as the body is refused", body: () => gz(chatgptRaw), encoding: "gzip", status: 400, code: "payload_invalid" },
  { name: "D14-T12: a placeholder with an unknown category is refused", body: () => gz(makeBody(["Old [redacted:foo:12345678] here."])), encoding: "gzip", status: 422, code: "source_placeholder_invalid" },
  { name: "D4-T12: turn lines out of order are refused", body: () => gz(swappedTurnLines()), encoding: "gzip", status: 400, code: "payload_invalid" },
];

describe("POST /api/sources refusals", () => {
  it.each(refusals)("$name", async (refusal) => {
    const person = await newPerson();
    const reply = await post(person.sessionToken, refusal.body(), refusal.encoding);
    expect(reply.statusCode).toBe(refusal.status);
    expect(ErrorBody.parse(reply.json()).code).toBe(refusal.code);
    expect(await countSources(person.personId)).toBe(0);
  });
});

describe("POST /api/sources stored rows", () => {
  it("INV3-T1: COUNT(*) of redactions equals the placeholders in the stored text", async () => {
    const person = await newPerson();
    const body = gz(makeBody(["Mail priya.nair@example.com or call +65 9123 4567 today.", "```bash\nAPI_KEY=abc\n```", "Nothing here to hide."]));
    const reply = await post(person.sessionToken, body);
    expect(reply.statusCode).toBe(201);
    const created = SourceCreateResponse.parse(reply.json());
    expect({ turnCount: created.turnCount, redactionCount: created.redactionCount, duplicate: created.duplicate }).toEqual({ turnCount: 3, redactionCount: 3, duplicate: false });
    const turns = await storedTurns(person.personId, created.sourceId);
    expect(turns.map((turn) => turn.text)).toEqual(["Mail [redacted:email:00000001] or call [redacted:phone:00000002] today.", "[code: bash, 1 lines]", "Nothing here to hide."]);
    const redactions = await asPerson(testApp.db, person.personId, (trx) =>
      trx.selectFrom("redactions").innerJoin("turns", "turns.id", "redactions.turn_id").select(["redactions.category", "redactions.placeholder_id", "turns.turn_index"]).where("redactions.source_id", "=", created.sourceId).orderBy("redactions.placeholder_id").execute(),
    );
    expect(redactions.map((row) => [row.category, row.placeholder_id, row.turn_index])).toEqual([
      ["email", "00000001", 0],
      ["phone", "00000002", 0],
      ["code", "00000003", 1],
    ]);
    expect(redactions.length).toBe(turns.reduce((sum, turn) => sum + countPlaceholders(turn.text), 0));
  });

  it("D11-T4: a client that skipped the scrub still has the email replaced before storage", async () => {
    const person = await newPerson();
    const created = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody(["Write to me at asha.rao@example.com."])))).json());
    expect(created.redactionCount).toBe(1);
    expect((await storedTurns(person.personId, created.sourceId))[0]?.text).toBe("Write to me at [redacted:email:00000001].");
  });

  it("D14-T11: browser placeholder ids are renumbered from 00000001 in turn order", async () => {
    const person = await newPerson();
    const created = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody(["Old [redacted:email:0000000f] here.", "Call +65 9123 4567 later."])))).json());
    const turns = await storedTurns(person.personId, created.sourceId);
    expect(turns.map((turn) => turn.text)).toEqual(["Old [redacted:email:00000001] here.", "Call [redacted:phone:00000002] later."]);
  });

  it("D8-T1: the same NDJSON twice stores one source and returns the first id with duplicate true", async () => {
    const person = await newPerson();
    const body = gz(makeBody(["I like long walks in the rain."]));
    const first = SourceCreateResponse.parse((await post(person.sessionToken, body)).json());
    expect(first).toEqual({ sourceId: first.sourceId, turnCount: 1, redactionCount: 0, duplicate: false });
    const second = await post(person.sessionToken, body);
    expect(second.statusCode).toBe(201);
    expect(SourceCreateResponse.parse(second.json())).toEqual({ sourceId: first.sourceId, turnCount: 1, redactionCount: 0, duplicate: true });
    expect(await countSources(person.personId)).toBe(1);
  });

  it("R1.5-T1: the same turns with different browser placeholder ids are one source", async () => {
    const person = await newPerson();
    const first = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody(["Mail [redacted:email:00000005] today."])))).json());
    const second = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody(["Mail [redacted:email:0000000a] today."])))).json());
    expect(second.duplicate).toBe(true);
    expect(second.sourceId).toBe(first.sourceId);
    expect((await storedTurns(person.personId, first.sourceId))[0]?.text).toBe("Mail [redacted:email:00000001] today.");
  });

  it("INV2-T1: two identical uploads sent at once leave one sources row", async () => {
    const person = await newPerson();
    const body = gz(makeBody(["Two posts at the same moment."]));
    const [a, b] = await Promise.all([post(person.sessionToken, body), post(person.sessionToken, body)]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    const replies = [SourceCreateResponse.parse(a.json()), SourceCreateResponse.parse(b.json())];
    expect(replies.filter((reply) => reply.duplicate).length).toBe(1);
    expect(replies[0]?.sourceId).toBe(replies[1]?.sourceId);
    expect(await countSources(person.personId)).toBe(1);
  });

  it("D4-T6: an uncompressed body with no Content-Encoding is accepted", async () => {
    const person = await newPerson();
    expect((await post(person.sessionToken, Buffer.from(makeBody(["A plain body is fine here."])), null)).statusCode).toBe(201);
  });

  it("D60-T1: a fourth source is refused and a duplicate of the first is still answered", async () => {
    const person = await newPerson();
    const firstText = ["First source text."];
    for (const texts of [firstText, ["Second source text."], ["Third source text."]]) {
      expect((await post(person.sessionToken, gz(makeBody(texts)))).statusCode).toBe(201);
    }
    const refused = await post(person.sessionToken, gz(makeBody(["Fourth source text."])));
    expect(refused.statusCode).toBe(429);
    expect(ErrorBody.parse(refused.json()).code).toBe("source_limit_reached");
    const again = await post(person.sessionToken, gz(makeBody(firstText)));
    expect(again.statusCode).toBe(201);
    expect(SourceCreateResponse.parse(again.json()).duplicate).toBe(true);
    expect(await countSources(person.personId)).toBe(3);
  });

  it("R2.9-T1: the source row records its versions, attestation and sizes", async () => {
    const person = await newPerson();
    const created = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody(["A source with a known size."])))).json());
    const row = await asPerson(testApp.db, person.personId, (trx) => trx.selectFrom("sources").selectAll().where("id", "=", created.sourceId).executeTakeFirstOrThrow());
    expect(row.kind).toBe("paste");
    expect(row.parser_version).toBe("1");
    expect(row.scrub_version).toBe("1");
    expect(row.attested_at).not.toBeNull();
    expect(Number(row.persona_signal)).toBe(0.5);
    expect(row.turn_count).toBe(1);
    expect(row.canonical_chars).toBe(27);
    expect(row.frozen_at).toBeNull();
    expect(row.names_reviewed_at).toBeNull();
    expect(row.sensitive_opt_in).toEqual([]);
  });

  it("R7.7-T2: a turn sent with U+202E is stored without it", async () => {
    const person = await newPerson();
    const created = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody(["I am‮ here"])))).json());
    expect((await storedTurns(person.personId, created.sourceId))[0]?.text).toBe("I am here");
  });

  it("D7-T2: the stored text is the canonical text, emoji and accent included", async () => {
    const person = await newPerson();
    const input = "I cried \u{1F602} at the café and laughed.";
    const created = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody([input])))).json());
    const stored = (await storedTurns(person.personId, created.sourceId))[0];
    expect(stored?.text).toBe(canonicalise(input));
    expect(stored?.text).toBe("I cried \u{1F602} at the café and laughed.");
    expect(stored?.norm_text).toBe(normQuote(stored?.text ?? ""));
  });

  it("INV1-T2: stored turns are role user with norm_text equal to normQuote(text)", async () => {
    const person = await newPerson();
    const created = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody(["First “quoted” turn.", "Second turn."])))).json());
    const turns = await storedTurns(person.personId, created.sourceId);
    expect(turns.length).toBe(2);
    for (const turn of turns) {
      expect(turn.role).toBe("user");
      expect(turn.norm_text).toBe(normQuote(turn.text));
    }
  });

  it("R2.1-T3: the fenced env turn is stored as one code placeholder", async () => {
    const person = await newPerson();
    const created = SourceCreateResponse.parse((await post(person.sessionToken, gz(makeBody([fencedEnv])))).json());
    const turns = await storedTurns(person.personId, created.sourceId);
    expect(turns[0]?.text).toBe("Here is the env file that broke my deploy:\n\n[code: bash, 3 lines]\n\nI moved it out of the repo after that.\n");
    expect(turns[0]?.text).not.toContain("DATABASE_URL=");
    const count = await asPerson(testApp.db, person.personId, (trx) => trx.selectFrom("redactions").select((eb) => eb.fn.countAll().as("count")).where("source_id", "=", created.sourceId).executeTakeFirstOrThrow());
    expect(Number(count.count)).toBe(1);
  });

  it("D15-T1: storeUpload asks for the names pass on a new source, and on a duplicate only until the pass has finished", async () => {
    const person = await newPerson();
    const body = parseSourceBody(Buffer.from(makeBody(["Names pass check."])));
    const first = await asPerson(testApp.db, person.personId, (trx) => storeUpload(trx, { personId: person.personId, body }, new Date()));
    expect(first).toMatchObject({ isDuplicate: false, needsNamesPass: true });
    const second = await asPerson(testApp.db, person.personId, (trx) => storeUpload(trx, { personId: person.personId, body }, new Date()));
    expect(second).toMatchObject({ isDuplicate: true, needsNamesPass: true });
    await withPerson(worker, person.personId, (trx) => trx.insertInto("names_passes").values({ source_id: first.sourceId, person_id: person.personId }).execute());
    const third = await asPerson(testApp.db, person.personId, (trx) => storeUpload(trx, { personId: person.personId, body }, new Date()));
    expect(third).toMatchObject({ isDuplicate: true, needsNamesPass: false });
  });

  it("R1.6-T1: a connection killed halfway through the body leaves no source", async () => {
    await testApp.app.listen({ port: 0, host: "127.0.0.1" });
    const address = testApp.app.server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const person = await newPerson();
    const body = gz(makeBody(Array.from({ length: 200 }, (entry, index) => "turn " + String(index) + " " + "w".repeat(1000))));
    await new Promise<void>((resolve) => {
      const clientRequest = httpRequest({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: routes.sources.createSource.path,
        headers: { cookie: `${SESSION_COOKIE}=${person.sessionToken}`, origin: ORIGIN, "content-type": "application/x-ndjson", "content-encoding": "gzip", "content-length": String(body.length) },
      });
      clientRequest.on("error", () => undefined);
      clientRequest.write(body.subarray(0, Math.floor(body.length / 2)));
      setTimeout(() => {
        clientRequest.destroy();
        resolve();
      }, 200);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await countSources(person.personId)).toBe(0);
    expect((await post(person.sessionToken, Buffer.from(makeBody(["After the drop."])), null)).statusCode).toBe(201);
  });
});
