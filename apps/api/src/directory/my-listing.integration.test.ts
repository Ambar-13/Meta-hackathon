import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { CURATED_QUESTIONS, ListedMeetingsView, MyListing, routes } from "@meet-first/contracts";
import { asPerson, createApprovedCard, createFrozenSource, createTestPerson } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { TEST_APP_ORIGIN } from "../testing/app-factory.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerDirectoryRoutes } from "./index.js";

// The three turns every seeded person uploads. createApprovedCard quotes them in turn, so items 1 and 4 quote the first, 2 and 5 the second, 3 and 6 the third.
const TURNS = ["I plan the week on Sunday night and keep to it.", "I answer messages only after lunch.", "Honest feedback matters more to me than comfort."];

// A seeded person: a session, a frozen source of TURNS, and an approved card whose items are all approved and verified.
type Member = { personId: string; sessionToken: string; cardId: string; itemIds: string[]; turnIds: string[] };

let t: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerDirectoryRoutes] });
});

afterAll(async () => {
  await t.close();
});

// Makes one person with a frozen source of TURNS and an approved card of this many items (6 unless given).
async function seedMember(displayName: string, items = 6): Promise<Member> {
  const person = await createTestPerson(t.db, displayName);
  const source = await createFrozenSource(t.db, person.personId, [...TURNS]);
  const card = await createApprovedCard(t.db, source.sourceId, { items });
  return { personId: person.personId, sessionToken: person.sessionToken, cardId: card.cardId, itemIds: card.itemIds, turnIds: source.turnIds };
}

// Sends one request through the test app as this person, or with no session when null, always with the app's Origin, and with a JSON body when one is given.
function send(member: { sessionToken: string } | null, call: { method: "GET" | "PUT" | "POST" | "DELETE"; url: string; payload?: unknown }) {
  const headers: Record<string, string> = member === null ? { origin: TEST_APP_ORIGIN } : sessionHeader(member.sessionToken);
  if (call.payload !== undefined) headers["content-type"] = "application/json";
  return t.app.inject({ method: call.method, url: call.url, headers, ...(call.payload === undefined ? {} : { payload: JSON.stringify(call.payload) }) });
}

// Marks these positions of a card public, as its owner (the person's first card unless another card id is given).
async function markPublic(member: Member, positions: number[], cardId = member.cardId): Promise<void> {
  await asPerson(t.db, member.personId, (trx) => trx.updateTable("card_items").set({ is_public: true }).where("card_id", "=", cardId).where("position", "in", positions).execute());
}

// Lists the person in the directory with their first card and this line, as that person; returns the listing id.
async function listMember(member: Member, line: string, isOpenToRomance = false): Promise<string> {
  const row = await asPerson(t.db, member.personId, (trx) => trx.insertInto("directory_listings").values({ person_id: member.personId, card_id: member.cardId, line, open_to_romance: isOpenToRomance }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

// Gives the person a second approved card of six items on a second source of TURNS; returns its id.
async function secondCard(member: Member): Promise<string> {
  const source = await createFrozenSource(t.db, member.personId, [...TURNS]);
  return (await createApprovedCard(t.db, source.sourceId, { items: 6 })).cardId;
}

// Holds the person's people row with FOR NO KEY UPDATE in a transaction of its own until release is called; resolves once the row is held.
async function holdPersonRow(member: Member): Promise<{ release: () => void; done: Promise<void> }> {
  let release = (): void => undefined;
  let markHeld = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = asPerson(t.db, member.personId, async (trx) => {
    await trx.selectFrom("people").select("id").where("id", "=", member.personId).forNoKeyUpdate().execute();
    markHeld();
    await released;
  });
  await held;
  return { release, done };
}

// Waits this many milliseconds, so rows made one after the other get created_at values in that order.
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// The curated question with this id, in the shape directMeeting takes.
function curated(id: number): { questionId: number; text: string; kind: string } {
  const row = CURATED_QUESTIONS.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error("no curated question " + String(id));
  return { questionId: row.id, text: row.text, kind: row.kind };
}

// Makes a directory meeting through directory_meeting_create as the visitor, past the route and its two caps, with a per-listing cap of 100; returns the meeting id.
async function directMeeting(visitor: Member, listingId: string, question: { questionId: number | null; text: string; kind: string | null }): Promise<string> {
  const result = await asPerson(t.db, visitor.personId, (trx) => sql<{ id: string | null }>`SELECT directory_meeting_create(${listingId}::uuid, ${visitor.personId}::uuid, ${visitor.cardId}::uuid, ${question.questionId}::int, ${question.text}, ${question.questionId !== null}, ${question.kind}::text, ${100}) AS id`.execute(trx));
  const id = result.rows[0]?.id;
  if (id === null || id === undefined) throw new Error("directory_meeting_create returned no id");
  return id;
}

describe("your listing routes", () => {
  it("W6-DAPI-T14 (design section 6, P2): GET /api/directory/me is 404 not_listed before the person lists", async () => {
    const lea = await seedMember("Lea Listing");

    const response = await send(lea, { method: "GET", url: routes.directory.readMyListing.path });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "not_listed", message: "You are not in the directory." });
  });

  it("W6-DAPI-T15 (design section 6, P2, P8): listing answers MyListing with the card's public items in position order and the dating switch, and GET reads the same", async () => {
    const max = await seedMember("Max Listing");
    await markPublic(max, [3, 1]);

    const put = await send(max, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: max.cardId, line: "  I build data tools.  ", openToRomance: false } });
    const listing = MyListing.parse(put.json());
    const get = await send(max, { method: "GET", url: routes.directory.readMyListing.path });
    const rows = await asPerson(t.db, max.personId, (trx) => trx.selectFrom("directory_listings").select("id").where("person_id", "=", max.personId).execute());

    expect(put.statusCode).toBe(200);
    expect(listing.cardId).toBe(max.cardId);
    expect(listing.line).toBe("I build data tools.");
    expect(listing.openToRomance).toBe(false);
    expect(listing.items).toEqual([
      { kind: "value", claim: "Test claim 1", quote: "I plan the week on Sunday night and keep to it." },
      { kind: "habit", claim: "Test claim 3", quote: "Honest feedback matters more to me than comfort." },
    ]);
    expect(Math.abs(Date.parse(listing.createdAt) - Date.now())).toBeLessThan(5000);
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(put.json());
    expect(rows).toEqual([{ id: listing.listingId }]);
  });

  it("W6-DAPI-T16 (design section 6, P8): a second PUT keeps the listing id and its created time and changes the card, the line and the dating switch", async () => {
    const ned = await seedMember("Ned Listing");
    await markPublic(ned, [1]);
    const first = MyListing.parse((await send(ned, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: ned.cardId, line: "First line.", openToRomance: false } })).json());
    const other = await secondCard(ned);
    await markPublic(ned, [2], other);
    await pause(10);

    const second = await send(ned, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: other, line: "Second line.", openToRomance: true } });
    const listing = MyListing.parse(second.json());
    const rows = await asPerson(t.db, ned.personId, (trx) => trx.selectFrom("directory_listings").select(["card_id", "open_to_romance"]).where("person_id", "=", ned.personId).execute());

    expect(second.statusCode).toBe(200);
    expect(listing.listingId).toBe(first.listingId);
    expect(listing.createdAt).toBe(first.createdAt);
    expect(listing.cardId).toBe(other);
    expect(listing.line).toBe("Second line.");
    expect(listing.openToRomance).toBe(true);
    expect(listing.items).toEqual([{ kind: "preference", claim: "Test claim 2", quote: "I answer messages only after lunch." }]);
    expect(rows).toEqual([{ card_id: other, open_to_romance: true }]);
  });

  it("W6-DAPI-T17 (design section 6): listing refuses a card that is not the caller's approved card, and a card with no public item", async () => {
    const oli = await seedMember("Oli Listing");
    const pia = await seedMember("Pia Listing");
    await markPublic(pia, [1]);

    const foreign = await send(oli, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: pia.cardId, line: "Hello.", openToRomance: false } });
    const missing = await send(oli, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: "00000000-0000-4000-8000-000000000999", line: "Hello.", openToRomance: false } });
    const noPublic = await send(oli, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: oli.cardId, line: "Hello.", openToRomance: false } });
    await markPublic(oli, [1]);
    await asPerson(t.db, oli.personId, (trx) => trx.updateTable("cards").set({ state: "ready", approved_at: null }).where("id", "=", oli.cardId).execute());
    const notApproved = await send(oli, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: oli.cardId, line: "Hello.", openToRomance: false } });
    const rows = await asPerson(t.db, oli.personId, (trx) => trx.selectFrom("directory_listings").select("id").where("person_id", "=", oli.personId).execute());

    const notApprovedBody = { code: "card_not_approved", message: "approve your card before creating a meeting." };
    expect(foreign.statusCode).toBe(409);
    expect(foreign.json()).toEqual(notApprovedBody);
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual(notApprovedBody);
    expect(noPublic.statusCode).toBe(409);
    expect(noPublic.json()).toEqual({ code: "listing_needs_public_item", message: "A listed persona needs at least one public item. Mark one, or leave the directory first." });
    expect(notApproved.statusCode).toBe(409);
    expect(notApproved.json()).toEqual(notApprovedBody);
    expect(rows).toEqual([]);
  });

  it("W6-DAPI-T18 (design section 6): a body ListingUpsert refuses is 400 payload_invalid", async () => {
    const quin = await seedMember("Quin Listing");
    await markPublic(quin, [1]);

    const blankLine = await send(quin, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: quin.cardId, line: "   ", openToRomance: false } });
    const longLine = await send(quin, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: quin.cardId, line: "x".repeat(141), openToRomance: false } });
    const noSwitch = await send(quin, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: quin.cardId, line: "Fine." } });
    const rows = await asPerson(t.db, quin.personId, (trx) => trx.selectFrom("directory_listings").select("id").where("person_id", "=", quin.personId).execute());

    const refusal = { code: "payload_invalid", message: "The request body did not match the expected shape. Reload and try again." };
    expect(blankLine.statusCode).toBe(400);
    expect(blankLine.json()).toEqual(refusal);
    expect(longLine.statusCode).toBe(400);
    expect(longLine.json()).toEqual(refusal);
    expect(noSwitch.statusCode).toBe(400);
    expect(noSwitch.json()).toEqual(refusal);
    expect(rows).toEqual([]);
  });

  it("W6-DAPI-T19 (design section 6, P2): leaving deletes the listing at once and answers 204 also when not listed", async () => {
    const rex = await seedMember("Rex Listing");
    await markPublic(rex, [1]);
    const joined = await send(rex, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: rex.cardId, line: "I like maps.", openToRomance: false } });

    const left = await send(rex, { method: "DELETE", url: routes.directory.leave.path });
    const after = await send(rex, { method: "GET", url: routes.directory.readMyListing.path });
    const leftAgain = await send(rex, { method: "DELETE", url: routes.directory.leave.path });
    const rows = await asPerson(t.db, rex.personId, (trx) => trx.selectFrom("directory_listings").select("id").where("person_id", "=", rex.personId).execute());

    expect(joined.statusCode).toBe(200);
    expect(left.statusCode).toBe(204);
    expect(left.body).toBe("");
    expect(after.statusCode).toBe(404);
    expect(after.json()).toEqual({ code: "not_listed", message: "You are not in the directory." });
    expect(leftAgain.statusCode).toBe(204);
    expect(leftAgain.body).toBe("");
    expect(rows).toEqual([]);
  });

  it("W6-DAPI-T20 (P2): leaving clears the link from help answers that came from the listing", async () => {
    const sam = await seedMember("Sam Listing");
    const tia = await seedMember("Tia Listing");
    await markPublic(tia, [1]);
    const tiaListing = await listMember(tia, "I teach statistics.");
    const askId = (await asPerson(t.db, sam.personId, (trx) => trx.insertInto("persona_asks").values({ person_id: sam.personId, mode: "help", text: "My survey answers look odd." }).returning("id").executeTakeFirstOrThrow())).id;
    await asPerson(t.db, sam.personId, (trx) => trx.insertInto("persona_answers").values({ ask_id: askId, asker_person_id: sam.personId, subject_person_id: tia.personId, subject_card_id: tia.cardId, listing_id: tiaListing, mode: "help", ask_text: "My survey answers look odd.", asker_display_name: "Sam Listing", subject_display_name: "Tia Listing", shortlist_rank: 1 }).execute());

    const response = await send(tia, { method: "DELETE", url: routes.directory.leave.path });
    const links = await asPerson(t.db, sam.personId, (trx) => trx.selectFrom("persona_answers").select(["subject_person_id", "listing_id"]).where("ask_id", "=", askId).execute());

    expect(response.statusCode).toBe(204);
    expect(links).toEqual([{ subject_person_id: tia.personId, listing_id: null }]);
  });

  it("W6-DAPI-T21 (design section 6, P4): the listed person's meeting list shows the directory meetings where they were the listed side, newest first, with the other person's name", async () => {
    const uma = await seedMember("Uma Listed");
    await markPublic(uma, [1]);
    const umaListing = await listMember(uma, "I like debates.");
    const vic = await seedMember("Vic Visitor");
    const wes = await seedMember("Wes Visitor");
    const first = await directMeeting(vic, umaListing, curated(13));
    await pause(10);
    const second = await directMeeting(wes, umaListing, { questionId: null, text: "Should students start a company before they graduate?", kind: null });

    const response = await send(uma, { method: "GET", url: routes.directory.listedMeetings.path });
    const visitorView = await send(vic, { method: "GET", url: routes.directory.listedMeetings.path });
    const view = ListedMeetingsView.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(view.meetings.map(({ meetingId, otherDisplayName, questionText, state }) => ({ meetingId, otherDisplayName, questionText, state }))).toEqual([
      { meetingId: second, otherDisplayName: "Wes Visitor", questionText: "Should students start a company before they graduate?", state: "ready" },
      { meetingId: first, otherDisplayName: "Vic Visitor", questionText: "Debate: should students start companies before they graduate? Where do our views split?", state: "ready" },
    ]);
    for (const meeting of view.meetings) {
      expect(Math.abs(Date.parse(meeting.createdAt) - Date.now())).toBeLessThan(60000);
    }
    expect(response.body).not.toContain(uma.personId);
    expect(response.body).not.toContain(vic.personId);
    expect(response.body).not.toContain(wes.personId);
    expect(visitorView.statusCode).toBe(200);
    expect(visitorView.json()).toEqual({ meetings: [] });
  });

  it("W6-DAPI-T22 (design section 6): the meeting list stops at 50, newest first", async () => {
    const xan = await seedMember("Xan Listed");
    await markPublic(xan, [1]);
    const xanListing = await listMember(xan, "I host many meetings.");
    const yul = await seedMember("Yul Visitor");
    const ids: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      ids.push(await directMeeting(yul, xanListing, curated(1)));
    }

    const response = await send(xan, { method: "GET", url: routes.directory.listedMeetings.path });
    const view = ListedMeetingsView.parse(response.json());
    const times = view.meetings.map((meeting) => Date.parse(meeting.createdAt));

    expect(response.statusCode).toBe(200);
    expect(view.meetings).toHaveLength(50);
    expect(new Set(view.meetings.map((meeting) => meeting.meetingId))).toEqual(new Set(ids.slice(1)));
    expect(times).toEqual([...times].sort((left, right) => right - left));
  });

  it("W6-DAPI-T23 (design section 6): a listing change waits while another transaction holds the caller's people row", async () => {
    const kai = await seedMember("Kai Listing");
    await markPublic(kai, [1]);

    const hold = await holdPersonRow(kai);
    const pending = send(kai, { method: "PUT", url: routes.directory.upsertMyListing.path, payload: { cardId: kai.cardId, line: "I like quiet work.", openToRomance: false } });
    const early = await Promise.race([pending.then(() => "finished"), new Promise((resolve) => setTimeout(() => { resolve("waiting"); }, 300))]);
    hold.release();
    await hold.done;
    const response = await pending;

    expect(early).toBe("waiting");
    expect(response.statusCode).toBe(200);
    expect(MyListing.parse(response.json()).line).toBe("I like quiet work.");
  });
});
