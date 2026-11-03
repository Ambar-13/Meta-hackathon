import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AsksView, AskView, ErrorBody, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { createApprovedCard, createFrozenSource, createPairedMeetingWithTurns, createTestPerson, SEED_TURNS_A } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { registerAsksRoutes } from "./index.js";

// The origin every request of this file sends: the test app's own address.
const ORIGIN = "http://localhost:3000";

let t: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  t = await buildTestApp({ routes: [registerAsksRoutes], env: { APP_ORIGIN: ORIGIN } });
});
afterAll(async () => {
  await t.close();
});

// One request: method, URL, the session token of the person making it (none for a request without a session), a JSON payload or a
// raw string payload, and whether to leave out the Origin header.
type Call = { method: "GET" | "POST"; url: string; token?: string; payload?: unknown; withoutOrigin?: boolean };

// The text a payload is sent as: a string as it is, anything else as JSON.
function payloadText(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

// Makes one request through the app's injector and returns the status, the headers and the parsed body.
async function send(call: Call): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (call.withoutOrigin !== true) headers.origin = ORIGIN;
  if (call.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${call.token}`;
  const payload = payloadText(call.payload);
  const response = await t.app.inject({ method: call.method, url: call.url, headers, ...(payload === undefined ? {} : { payload }) });
  return { statusCode: response.statusCode, headers: response.headers, body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown) };
}

// One seeded person: the session token a request sends, the approved card, and the display name.
type Person = { personId: string; sessionToken: string; cardId: string; name: string };

// Creates a person with a frozen source of the three SEED_TURNS_A turns and an approved card of 6 items quoting them.
async function seedPerson(name: string): Promise<Person> {
  const person = await createTestPerson(t.db, name);
  const source = await createFrozenSource(t.db, person.personId, [...SEED_TURNS_A]);
  const card = await createApprovedCard(t.db, source.sourceId);
  return { personId: person.personId, sessionToken: person.sessionToken, cardId: card.cardId, name };
}

// Lists the person in the directory with their first two items public, as the sharing part and the directory switch would,
// and returns the listing id.
async function listInDirectory(person: Person): Promise<string> {
  const row = await withPerson(t.db, person.personId, async (trx) => {
    await trx.updateTable("card_items").set({ is_public: true }).where("card_id", "=", person.cardId).where("position", "<=", 2).execute();
    return trx.insertInto("directory_listings").values({ person_id: person.personId, card_id: person.cardId, line: "I fix flaky deploys." }).returning("id").executeTakeFirstOrThrow();
  });
  return row.id;
}

// The text of every seeded ask.
const ASK_TEXT = "Our deploys fail at night and nobody knows why.";
// The reply to every refused read.
const NOT_FOUND = { code: "not_found", message: "This no longer exists or is not yours." };

// One stored claim as run_ask writes it: text, quote, the turn's uuid, and both checks.
function storedClaim(input: { text: string; verified: boolean; supported: boolean | null }): Record<string, unknown> {
  return { text: input.text, quote: SEED_TURNS_A[0], turnId: randomUUID(), verified: input.verified, supported: input.supported };
}

// Writes one ask of the asker and returns its id: help, made now and on ASK_TEXT unless the input says otherwise.
async function seedAsk(input: { askerId: string; state: "checking" | "asking" | "ranking" | "done"; mode?: "help" | "react"; pairId?: string; aboutName?: string; createdAt?: Date; text?: string }): Promise<string> {
  const row = await withPerson(t.db, input.askerId, (trx) => trx.insertInto("persona_asks").values({
    person_id: input.askerId, mode: input.mode ?? "help", pair_id: input.pairId ?? null, text: input.text ?? ASK_TEXT, state: input.state,
    about_name: input.aboutName ?? null, created_at: input.createdAt ?? new Date(), finished_at: input.state === "done" ? new Date() : null,
  }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

// What one seeded answer holds besides its ask and its two people.
type AnswerSpec = { state: "pending" | "answered" | "failed"; position: number | null; shortlistRank: number; listingId: string | null; mode?: "help" | "react"; line?: string | null; createdAt?: Date };

// Writes one persona_answers row of an ask, as run_ask would, and returns its id.
async function seedAnswer(input: { askId: string; asker: { personId: string; name: string }; subject: Person; spec: AnswerSpec }): Promise<string> {
  const { spec } = input;
  const isAnswered = spec.state === "answered";
  const row = await withPerson(t.db, input.asker.personId, (trx) => trx.insertInto("persona_answers").values({
    ask_id: input.askId, asker_person_id: input.asker.personId, subject_person_id: input.subject.personId, subject_card_id: input.subject.cardId,
    listing_id: spec.listingId, mode: spec.mode ?? "help", ask_text: ASK_TEXT, asker_display_name: input.asker.name, subject_display_name: input.subject.name,
    subject_line: spec.line === undefined ? "I fix flaky deploys." : spec.line, shortlist_rank: spec.shortlistRank, state: spec.state,
    answer: isAnswered ? `${input.subject.name}'s persona would probably read the logs first.` : null, has_sign: isAnswered ? spec.position !== null : null,
    claims: JSON.stringify([storedClaim({ text: "Reads the logs first", verified: true, supported: true })]), supported_count: isAnswered ? 1 : null,
    position: spec.position, answered_at: isAnswered ? new Date() : null, created_at: spec.createdAt ?? new Date(),
  }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

// GET /api/asks/:id as one person.
async function readAsk(input: { token: string; askId: string }): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  return send({ method: "GET", url: routes.asks.readAsk.path.replace(":id", input.askId), token: input.token });
}

// GET /api/asks as one person.
async function listAsks(token: string): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  return send({ method: "GET", url: routes.asks.listAsks.path, token });
}

describe("GET /api/asks/:id and GET /api/asks", () => {
  it("W6-ASKA-T15 (design section 6): GET /api/asks/:id shows the asker their answered rows only, placed first by position and the rest by shortlist rank, with canMeet on the meetable ones", async () => {
    const asker = await createTestPerson(t.db, "Asker One");
    const mira = await seedPerson("Mira");
    const dev = await seedPerson("Dev");
    const sol = await seedPerson("Sol");
    const ana = await seedPerson("Ana");
    const kai = await seedPerson("Kai");
    const lou = await seedPerson("Lou");
    const bo = await seedPerson("Bo");
    const miraListing = await listInDirectory(mira);
    const devListing = await listInDirectory(dev);
    const anaListing = await listInDirectory(ana);
    const askId = await seedAsk({ askerId: asker.personId, state: "done" });
    const who = { personId: asker.personId, name: "Asker One" };
    await seedAnswer({ askId, asker: who, subject: mira, spec: { state: "answered", position: 2, shortlistRank: 3, listingId: miraListing } });
    await seedAnswer({ askId, asker: who, subject: dev, spec: { state: "answered", position: 1, shortlistRank: 4, listingId: devListing } });
    await seedAnswer({ askId, asker: who, subject: sol, spec: { state: "answered", position: null, shortlistRank: 1, listingId: null } });
    await seedAnswer({ askId, asker: who, subject: ana, spec: { state: "answered", position: 4, shortlistRank: 2, listingId: anaListing } });
    await seedAnswer({ askId, asker: who, subject: kai, spec: { state: "answered", position: 3, shortlistRank: 5, listingId: null } });
    await seedAnswer({ askId, asker: who, subject: lou, spec: { state: "pending", position: null, shortlistRank: 6, listingId: null } });
    await seedAnswer({ askId, asker: who, subject: bo, spec: { state: "failed", position: null, shortlistRank: 7, listingId: null } });

    const response = await readAsk({ token: asker.sessionToken, askId });

    expect(response.statusCode).toBe(200);
    const view = AskView.parse(response.body);
    expect(view.state).toBe("done");
    expect(view.mode).toBe("help");
    expect(view.aboutName).toBeNull();
    expect(view.refusedReason).toBeNull();
    expect(view.text).toBe(ASK_TEXT);
    expect(view.answers.map((answer) => answer.displayName)).toEqual(["Dev", "Mira", "Kai", "Ana", "Sol"]);
    expect(view.answers.map((answer) => answer.position)).toEqual([1, 2, 3, 4, null]);
    expect(view.answers.map((answer) => answer.canMeet)).toEqual([true, true, false, false, false]);
    expect(view.answers.map((answer) => answer.hasSign)).toEqual([true, true, true, true, false]);
    const first = view.answers[0];
    expect(first?.line).toBe("I fix flaky deploys.");
    expect(first?.answer).toBe("Dev's persona would probably read the logs first.");
    expect(first?.claims).toEqual([{ text: "Reads the logs first", quote: SEED_TURNS_A[0], verified: true, supported: true }]);
  });

  it("W6-ASKA-T16 (design section 6): GET /api/asks/:id is 404 not_found for the person the persona speaks for, a stranger, an unknown id and an id that is not a uuid", async () => {
    const asker = await createTestPerson(t.db, "Asker One");
    const sol = await seedPerson("Sol");
    const stranger = await createTestPerson(t.db, "Stranger");
    const askId = await seedAsk({ askerId: asker.personId, state: "done" });
    await seedAnswer({ askId, asker: { personId: asker.personId, name: "Asker One" }, subject: sol, spec: { state: "answered", position: 1, shortlistRank: 1, listingId: null } });
    // The asker reads their own ask first, so a route that is missing cannot pass the 404 checks below.
    expect((await readAsk({ token: asker.sessionToken, askId })).statusCode).toBe(200);

    const asSubject = await readAsk({ token: sol.sessionToken, askId });
    const asStranger = await readAsk({ token: stranger.sessionToken, askId });
    const unknown = await readAsk({ token: asker.sessionToken, askId: randomUUID() });
    const notUuid = await readAsk({ token: asker.sessionToken, askId: "not-a-uuid" });

    for (const response of [asSubject, asStranger, unknown, notUuid]) {
      expect(response.statusCode).toBe(404);
      expect(ErrorBody.parse(response.body)).toEqual(NOT_FOUND);
    }
  });

  it("W6-ASKA-T17 (P6, design section 10): the ask view carries no person id, card id or listing id of the subject, and no support count or shortlist rank", async () => {
    const asker = await createTestPerson(t.db, "Asker One");
    const mira = await seedPerson("Mira");
    const miraListing = await listInDirectory(mira);
    const askId = await seedAsk({ askerId: asker.personId, state: "done" });
    await seedAnswer({ askId, asker: { personId: asker.personId, name: "Asker One" }, subject: mira, spec: { state: "answered", position: 1, shortlistRank: 1, listingId: miraListing } });

    const response = await readAsk({ token: asker.sessionToken, askId });

    expect(response.statusCode).toBe(200);
    const text = JSON.stringify(response.body);
    for (const hidden of [mira.personId, mira.cardId, miraListing, asker.personId]) expect(text).not.toContain(hidden);
    expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual(["aboutName", "answers", "askId", "createdAt", "mode", "refusedReason", "state", "text"]);
    expect(Object.keys((response.body as { answers: Array<Record<string, unknown>> }).answers[0] ?? {}).sort()).toEqual(["answer", "answerId", "canMeet", "claims", "displayName", "hasSign", "line", "position"]);
    expect(Object.keys((response.body as { answers: Array<{ claims: Array<Record<string, unknown>> }> }).answers[0]?.claims[0] ?? {}).sort()).toEqual(["quote", "supported", "text", "verified"]);
  });

  it("W6-ASKA-T18 (design section 6): a react ask view names the friend, and shows its one row only once it is answered, with line null and canMeet false", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    const friend: Person = { personId: m.b.personId, sessionToken: m.b.sessionToken, cardId: m.b.cardId, name: "Test B" };
    const askId = await seedAsk({ askerId: m.a.personId, state: "asking", mode: "react", pairId: m.pairId, aboutName: "Test B" });
    const answerId = await seedAnswer({ askId, asker: { personId: m.a.personId, name: "Test A" }, subject: friend, spec: { state: "pending", position: null, shortlistRank: 1, listingId: null, mode: "react", line: null } });

    const first = await readAsk({ token: m.a.sessionToken, askId });

    expect(first.statusCode).toBe(200);
    const firstView = AskView.parse(first.body);
    expect(firstView.state).toBe("asking");
    expect(firstView.mode).toBe("react");
    expect(firstView.aboutName).toBe("Test B");
    expect(firstView.answers).toEqual([]);

    await withPerson(t.db, m.a.personId, (trx) => trx.updateTable("persona_answers").set({ state: "answered", answer: "Test B's persona would probably ask for a backup plan.", has_sign: true, position: 1, supported_count: 1, answered_at: new Date() }).where("id", "=", answerId).execute());
    await withPerson(t.db, m.a.personId, (trx) => trx.updateTable("persona_asks").set({ state: "done", finished_at: new Date() }).where("id", "=", askId).execute());

    const second = await readAsk({ token: m.a.sessionToken, askId });

    const answers = AskView.parse(second.body).answers;
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ answerId, displayName: "Test B", line: null, answer: "Test B's persona would probably ask for a backup plan.", hasSign: true, position: 1, canMeet: false });
  });

  it("W6-ASKA-T19 (design section 6, P4): GET /api/asks gives the caller's asks newest first and the answered copies of their persona newest first, with who asked and what, and no person id of an asker", async () => {
    const sol = await seedPerson("Sol");
    const askerOne = await createTestPerson(t.db, "Asker One");
    const askerTwo = await createTestPerson(t.db, "Asker Two");
    const now = Date.now();
    const askOne = await seedAsk({ askerId: askerOne.personId, state: "done", createdAt: new Date(now - 180_000) });
    await seedAnswer({ askId: askOne, asker: { personId: askerOne.personId, name: "Asker One" }, subject: sol, spec: { state: "answered", position: 1, shortlistRank: 1, listingId: null, createdAt: new Date(now - 120_000) } });
    const askTwo = await seedAsk({ askerId: askerTwo.personId, state: "done", createdAt: new Date(now - 90_000) });
    await seedAnswer({ askId: askTwo, asker: { personId: askerTwo.personId, name: "Asker Two" }, subject: sol, spec: { state: "answered", position: 1, shortlistRank: 1, listingId: null, createdAt: new Date(now - 60_000) } });
    const askThree = await seedAsk({ askerId: askerOne.personId, state: "asking", createdAt: new Date(now - 30_000) });
    await seedAnswer({ askId: askThree, asker: { personId: askerOne.personId, name: "Asker One" }, subject: sol, spec: { state: "pending", position: null, shortlistRank: 1, listingId: null } });
    const askFour = await seedAsk({ askerId: askerTwo.personId, state: "done", createdAt: new Date(now - 20_000) });
    await seedAnswer({ askId: askFour, asker: { personId: askerTwo.personId, name: "Asker Two" }, subject: sol, spec: { state: "failed", position: null, shortlistRank: 1, listingId: null } });

    const asSol = await listAsks(sol.sessionToken);

    expect(asSol.statusCode).toBe(200);
    const viewOfSol = AsksView.parse(asSol.body);
    expect(viewOfSol.asked).toEqual([]);
    expect(viewOfSol.aboutMe.map((copy) => copy.askerName)).toEqual(["Asker Two", "Asker One"]);
    expect(viewOfSol.aboutMe[0]).toMatchObject({ mode: "help", text: ASK_TEXT, answer: "Sol's persona would probably read the logs first.", claims: [{ text: "Reads the logs first", quote: SEED_TURNS_A[0], verified: true, supported: true }] });
    expect(JSON.stringify(asSol.body)).not.toContain(askerOne.personId);
    expect(JSON.stringify(asSol.body)).not.toContain(askerTwo.personId);

    const asOne = await listAsks(askerOne.sessionToken);

    const viewOfOne = AsksView.parse(asOne.body);
    expect(viewOfOne.asked.map((ask) => ask.askId)).toEqual([askThree, askOne]);
    expect(viewOfOne.asked[0]?.state).toBe("asking");
    expect(viewOfOne.aboutMe).toEqual([]);
  });

  it("W6-ASKA-T20 (design section 6): both lists stop at 50 newest first, and both GET routes send cache-control no-store", async () => {
    const base = Date.now() - 3_600_000;
    const many = await createTestPerson(t.db, "Many Asks");
    let lastAskId = "";
    for (let index = 1; index <= 51; index += 1) {
      lastAskId = await seedAsk({ askerId: many.personId, state: "done", createdAt: new Date(base + index * 1000), text: "Seeded ask " + String(index).padStart(2, "0") });
    }
    const bo = await seedPerson("Bo");
    const askerMany = await createTestPerson(t.db, "Asker Many");
    for (let index = 1; index <= 51; index += 1) {
      const askId = await seedAsk({ askerId: askerMany.personId, state: "done", createdAt: new Date(base + index * 1000) });
      await seedAnswer({ askId, asker: { personId: askerMany.personId, name: "Asker Many" }, subject: bo, spec: { state: "answered", position: null, shortlistRank: 1, listingId: null, createdAt: new Date(base + index * 1000) } });
    }

    const askedList = await listAsks(many.sessionToken);

    expect(askedList.statusCode).toBe(200);
    const askedView = AsksView.parse(askedList.body);
    expect(askedView.asked).toHaveLength(50);
    expect(askedView.asked[0]?.text).toBe("Seeded ask 51");
    expect(askedView.asked[49]?.text).toBe("Seeded ask 02");
    expect(askedList.headers["cache-control"]).toBe("no-store");

    const copiesList = await listAsks(bo.sessionToken);
    const copiesView = AsksView.parse(copiesList.body);
    expect(copiesView.aboutMe).toHaveLength(50);
    expect(copiesView.aboutMe[0]?.createdAt).toBe(new Date(base + 51_000).toISOString());
    expect(copiesView.aboutMe[49]?.createdAt).toBe(new Date(base + 2_000).toISOString());

    const single = await readAsk({ token: many.sessionToken, askId: lastAskId });
    expect(single.statusCode).toBe(200);
    expect(single.headers["cache-control"]).toBe("no-store");
  });
});
