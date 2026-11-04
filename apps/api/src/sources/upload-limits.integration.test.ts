import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorBody, routes, SESSION_COOKIE, SourceCreateResponse } from "@meet-first/contracts";
import { asPerson, createTestPerson } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { registerSourcesRoutes } from "./index.js";
import { authoritativeScrub } from "./authoritative-scrub.js";

// Counts the calls the scrubber gets in this file. The spy passes every call on to the real scrubber, so only the count is new.
const scrubCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@meet-first/scrub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meet-first/scrub")>();
  return {
    ...actual,
    scrub: (...args: Parameters<typeof actual.scrub>) => {
      scrubCalls.count += 1;
      return actual.scrub(...args);
    },
  };
});

// The origin every request of this file carries, the same one the test app allows.
const ORIGIN = "http://localhost:3000";

let testApp: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  testApp = await buildTestApp({ routes: [registerSourcesRoutes], env: { APP_ORIGIN: ORIGIN } });
});

afterAll(async () => {
  await testApp.close();
});

// A new person for one test, so the source cap never crosses tests.
async function newPerson(): Promise<{ personId: string; sessionToken: string }> {
  return createTestPerson(testApp.db, "Asha Rao");
}

// The body of an upload: a header line, then one turn line per text.
function makeBody(texts: string[]): string {
  const headerLine = JSON.stringify({
    kind: "paste",
    parserVersion: "1",
    scrubVersion: "1",
    personaSignal: 0.5,
    attested: true,
    turnCount: texts.length,
  });
  const turnLines = texts.map((text, index) =>
    JSON.stringify({ turnIndex: index, role: "user", text, lang: "en", sensitiveCategories: [] }),
  );
  return [headerLine, ...turnLines].join("\n");
}

// Posts a gzip upload as one person.
function post(token: string, texts: string[]) {
  return testApp.app.inject({
    method: "POST",
    url: routes.sources.createSource.path,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin: ORIGIN,
      "content-type": "application/x-ndjson",
      "content-encoding": "gzip",
    },
    payload: gzipSync(Buffer.from(makeBody(texts), "utf8")),
  });
}

// How many sources one person holds, read as that person.
async function countSources(personId: string): Promise<number> {
  return asPerson(testApp.db, personId, async (trx) => {
    const counted = await trx
      .selectFrom("sources")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("person_id", "=", personId)
      .executeTakeFirstOrThrow();
    return Number(counted.count);
  });
}

describe("upload size limits run before any scrub work", () => {
  it("R1.4-T2: a canonical total over 2 MiB is refused before the scrubber runs", async () => {
    const person = await newPerson();
    const texts = Array.from({ length: 110 }, () => "a".repeat(19_999));
    scrubCalls.count = 0;
    const reply = await post(person.sessionToken, texts);
    expect(reply.statusCode).toBe(413);
    expect(ErrorBody.parse(reply.json()).code).toBe("source_too_large");
    expect(scrubCalls.count).toBe(0);
    expect(await countSources(person.personId)).toBe(0);
  });

  it("R1.4-T3: a normal upload does reach the scrubber, so the spy above counts real calls", async () => {
    const person = await newPerson();
    scrubCalls.count = 0;
    const reply = await post(person.sessionToken, ["A normal upload with one turn."]);
    expect(reply.statusCode).toBe(201);
    expect(SourceCreateResponse.parse(reply.json()).turnCount).toBe(1);
    expect(scrubCalls.count).toBeGreaterThan(0);
  });

  it("R1.7-T4: more turns than one source may hold are refused before any turn is scrubbed", () => {
    const turns = Array.from({ length: 10_001 }, (entry, index) => ({
      turnIndex: index,
      role: "user" as const,
      text: "note",
      lang: "en",
      sensitiveCategories: [],
    }));
    scrubCalls.count = 0;
    let thrown: unknown;
    try {
      authoritativeScrub(turns, []);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "source_too_many_turns" });
    expect(scrubCalls.count).toBe(0);
  });
});
