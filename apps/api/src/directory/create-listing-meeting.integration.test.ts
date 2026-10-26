import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { CURATED_QUESTIONS, MeetingCreateResponse, routes } from "@meet-first/contracts";
import { asPerson, createApprovedCard, createFrozenSource, createTestPerson } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { enqueuedJobs, TEST_APP_ORIGIN } from "../testing/app-factory.js";
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

// The URL of a route with its :id filled in.
function pathOf(route: { path: string }, id: string): string {
  return route.path.replace(":id", id);
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

// The two listed people the tests of this file meet: Lia, not open to dating questions, and Romy, open to them.
let lia: Member;
let liaListing: string;
let romy: Member;
let romyListing: string;

beforeAll(async () => {
  lia = await seedMember("Lia Listed");
  await markPublic(lia, [1, 2]);
  liaListing = await listMember(lia, "I enjoy a good debate.");
  romy = await seedMember("Romy Listed");
  await markPublic(romy, [1]);
  romyListing = await listMember(romy, "Open to a first date.", true);
});

// The meeting row as one of its members reads it.
function meetingRow(member: Member, meetingId: string) {
  return asPerson(t.db, member.personId, (trx) => trx.selectFrom("meetings").select(["question_id", "question_text", "question_kind", "question_checked_at", "state", "romance_allowed"]).where("id", "=", meetingId).executeTakeFirstOrThrow());
}

// How many meeting member rows the person has, read as that person.
async function membershipCount(member: Member): Promise<number> {
  const rows = await asPerson(t.db, member.personId, (trx) => trx.selectFrom("meeting_members").select("meeting_id").where("person_id", "=", member.personId).execute());
  return rows.length;
}

// Asks for a directory meeting through the route, as the visitor.
function meet(visitor: Member, listingId: string, payload: unknown) {
  return send(visitor, { method: "POST", url: pathOf(routes.directory.createListingMeeting, listingId), payload });
}

describe("meetings with a listed persona", () => {
  it("W6-DAPI-T30 (design section 6, R10.5): a curated debate question makes a checked, ready meeting with the listed side public-only, and enqueues check_question", async () => {
    const vera = await seedMember("Vera Visitor");

    const response = await meet(vera, liaListing, { questionId: 13, cardId: vera.cardId });
    const { meetingId } = MeetingCreateResponse.parse(response.json());
    const row = await meetingRow(vera, meetingId);
    const members = await asPerson(t.db, vera.personId, (trx) => trx.selectFrom("meeting_members").select(["side", "person_id", "card_id", "ready_at", "public_only"]).where("meeting_id", "=", meetingId).orderBy("side", "asc").execute());
    const pair = await asPerson(t.db, vera.personId, (trx) => trx.selectFrom("pairs").innerJoin("meetings", "meetings.pair_id", "pairs.id").select(["pairs.creator_person_id", "pairs.joiner_person_id", "pairs.via_directory", "pairs.joined_at"]).where("meetings.id", "=", meetingId).executeTakeFirstOrThrow());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ meetingId });
    expect(row.question_id).toBe(13);
    expect(row.question_text).toBe("Debate: should students start companies before they graduate? Where do our views split?");
    expect(row.question_kind).toBe("debate");
    expect(row.state).toBe("ready");
    expect(row.romance_allowed).toBe(false);
    expect(row.question_checked_at).not.toBeNull();
    expect(members.map((member) => ({ side: member.side, personId: member.person_id, cardId: member.card_id, ready: member.ready_at !== null, publicOnly: member.public_only }))).toEqual([
      { side: "a", personId: vera.personId, cardId: vera.cardId, ready: true, publicOnly: false },
      { side: "b", personId: lia.personId, cardId: lia.cardId, ready: true, publicOnly: true },
    ]);
    expect(pair.creator_person_id).toBe(vera.personId);
    expect(pair.joiner_person_id).toBe(lia.personId);
    expect(pair.via_directory).toBe(true);
    expect(pair.joined_at).not.toBeNull();
    expect(enqueuedJobs(t.app).at(-1)).toEqual({ name: "check_question", payload: { meetingId } });
  });

  it("W6-DAPI-T31 (design section 6, R10.5): free text makes an unchecked meeting of kind situation", async () => {
    const walt = await seedMember("Walt Visitor");

    const response = await meet(walt, liaListing, { freeText: "  Should we build a startup together after the hackathon?  ", cardId: walt.cardId });
    const { meetingId } = MeetingCreateResponse.parse(response.json());
    const row = await meetingRow(walt, meetingId);

    expect(response.statusCode).toBe(201);
    expect(row).toEqual({ question_id: null, question_text: "Should we build a startup together after the hackathon?", question_kind: "situation", question_checked_at: null, state: "ready", romance_allowed: false });
    expect(enqueuedJobs(t.app).at(-1)).toEqual({ name: "check_question", payload: { meetingId } });
  });

  it("W6-DAPI-T32 (design section 11, P8): a dating question reaches only a listing whose owner switched on dating questions", async () => {
    const xena = await seedMember("Xena Visitor");
    const jobsBefore = enqueuedJobs(t.app).length;

    const closed = await meet(xena, liaListing, { questionId: 17, cardId: xena.cardId });
    const jobsAfterClosed = enqueuedJobs(t.app).length;
    const membersAfterClosed = await membershipCount(xena);
    const opened = await meet(xena, romyListing, { questionId: 17, cardId: xena.cardId });
    const { meetingId } = MeetingCreateResponse.parse(opened.json());
    const row = await meetingRow(xena, meetingId);

    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toEqual({ code: "romance_not_open", message: "this person has not opened their persona to dating questions." });
    expect(jobsAfterClosed).toBe(jobsBefore);
    expect(membersAfterClosed).toBe(0);
    expect(opened.statusCode).toBe(201);
    expect(row.question_id).toBe(17);
    expect(row.question_text).toBe("Would we enjoy a first date, and what would we talk about?");
    expect(row.question_kind).toBe("romance");
    expect(row.state).toBe("ready");
    expect(row.romance_allowed).toBe(true);
    expect(row.question_checked_at).not.toBeNull();
    expect(enqueuedJobs(t.app)).toHaveLength(jobsBefore + 1);
  });

  it("W6-DAPI-T33 (design section 6): your own listing is 409 directory_self, a missing listing 404 listing_not_found, an id that is not a uuid 404 not_found", async () => {
    const yan = await seedMember("Yan Visitor");
    const jobsBefore = enqueuedJobs(t.app).length;

    const own = await meet(lia, liaListing, { questionId: 1, cardId: lia.cardId });
    const missing = await meet(yan, "00000000-0000-4000-8000-000000000999", { questionId: 1, cardId: yan.cardId });
    const notUuid = await meet(yan, "abc", { questionId: 1, cardId: yan.cardId });

    expect(own.statusCode).toBe(409);
    expect(own.json()).toEqual({ code: "directory_self", message: "this is your own listing; pick someone else in the directory." });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: "listing_not_found", message: "this persona is no longer in the directory." });
    expect(notUuid.statusCode).toBe(404);
    expect(notUuid.json()).toEqual({ code: "not_found", message: "This no longer exists or is not yours." });
    expect(enqueuedJobs(t.app)).toHaveLength(jobsBefore);
  });

  it("W6-DAPI-T34 (design section 6): the visitor's card must be their own approved card", async () => {
    const zoe = await seedMember("Zoe Visitor");
    const amy = await seedMember("Amy Visitor");
    await asPerson(t.db, zoe.personId, (trx) => trx.updateTable("cards").set({ state: "ready", approved_at: null }).where("id", "=", zoe.cardId).execute());

    const ownNotApproved = await meet(zoe, liaListing, { questionId: 1, cardId: zoe.cardId });
    const borrowedCard = await meet(amy, liaListing, { questionId: 1, cardId: zoe.cardId });

    const notApproved = { code: "card_not_approved", message: "approve your card before creating a meeting." };
    expect(ownNotApproved.statusCode).toBe(409);
    expect(ownNotApproved.json()).toEqual(notApproved);
    expect(borrowedCard.statusCode).toBe(409);
    expect(borrowedCard.json()).toEqual(notApproved);
    expect(await membershipCount(zoe)).toBe(0);
    expect(await membershipCount(amy)).toBe(0);
  });

  it("W6-DAPI-T35 (design section 5): an eleventh directory meeting for one listing in a UTC day is 429 directory_daily_cap", async () => {
    const capped = await seedMember("Cap Listed");
    await markPublic(capped, [1]);
    const cappedListing = await listMember(capped, "I meet many people.");
    const filler = await seedMember("Fill Visitor");
    for (let index = 0; index < 10; index += 1) {
      await directMeeting(filler, cappedListing, curated(1));
    }
    const bo = await seedMember("Bo Visitor");

    const response = await meet(bo, cappedListing, { questionId: 1, cardId: bo.cardId });
    const publicOnlyRows = await asPerson(t.db, capped.personId, (trx) => trx.selectFrom("meeting_members").select("meeting_id").where("person_id", "=", capped.personId).where("public_only", "=", true).execute());

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ code: "directory_daily_cap", message: "this persona has met as many people as it can today. Try again tomorrow." });
    expect(publicOnlyRows).toHaveLength(10);
    expect(await membershipCount(bo)).toBe(0);
  });

  it("W6-DAPI-T36 (design section 5, D60): a visitor in 5 meetings today gets 429 meeting_daily_cap before any listing check", async () => {
    const dee = await seedMember("Dee Listed");
    await markPublic(dee, [1]);
    const deeListing = await listMember(dee, "I like long talks.");
    const cy = await seedMember("Cy Visitor");
    for (let index = 0; index < 5; index += 1) {
      await directMeeting(cy, deeListing, curated(1));
    }

    const listed = await meet(cy, deeListing, { questionId: 1, cardId: cy.cardId });
    const unknown = await meet(cy, "00000000-0000-4000-8000-000000000999", { questionId: 1, cardId: cy.cardId });

    const capRefusal = { code: "meeting_daily_cap", message: "You have been in 5 meetings today. Try again tomorrow." };
    expect(listed.statusCode).toBe(429);
    expect(listed.json()).toEqual(capRefusal);
    expect(unknown.statusCode).toBe(429);
    expect(unknown.json()).toEqual(capRefusal);
    expect(await membershipCount(cy)).toBe(5);
  });

  it("W6-DAPI-T37 (design section 6): a body MeetingCreate refuses is 400 payload_invalid", async () => {
    const ida = await seedMember("Ida Visitor");

    const unknownQuestion = await meet(ida, liaListing, { questionId: 21, cardId: ida.cardId });
    const shortText = await meet(ida, liaListing, { freeText: "hi", cardId: ida.cardId });
    const noCard = await meet(ida, liaListing, { questionId: 1 });

    const refusal = { code: "payload_invalid", message: "The request body did not match the expected shape. Reload and try again." };
    expect(unknownQuestion.statusCode).toBe(400);
    expect(unknownQuestion.json()).toEqual(refusal);
    expect(shortText.statusCode).toBe(400);
    expect(shortText.json()).toEqual(refusal);
    expect(noCard.statusCode).toBe(400);
    expect(noCard.json()).toEqual(refusal);
    expect(await membershipCount(ida)).toBe(0);
  });
});
