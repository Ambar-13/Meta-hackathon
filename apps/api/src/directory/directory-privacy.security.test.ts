import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { CURATED_QUESTIONS, routes } from "@meet-first/contracts";
import {
  asPerson,
  createApprovedCard,
  createFrozenSource,
  createPairedMeeting,
  createTestPerson,
} from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { TEST_APP_ORIGIN } from "../testing/app-factory.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerDirectoryRoutes } from "./index.js";

// The three turns every seeded person uploads. createApprovedCard quotes them in turn, so items 1 and 4 quote the first, 2 and 5 the second, 3 and 6 the third.
const TURNS = [
  "I plan the week on Sunday night and keep to it.",
  "I answer messages only after lunch.",
  "Honest feedback matters more to me than comfort.",
];

// A seeded person: a session, a frozen source of TURNS, and an approved card whose items are all approved and verified.
type Member = {
  personId: string;
  sessionToken: string;
  cardId: string;
  itemIds: string[];
  turnIds: string[];
};

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
  return {
    personId: person.personId,
    sessionToken: person.sessionToken,
    cardId: card.cardId,
    itemIds: card.itemIds,
    turnIds: source.turnIds,
  };
}

// Sends one request through the test app as this person, or with no session when null, always with the app's Origin, and with a JSON body when one is given.
function send(
  member: { sessionToken: string } | null,
  call: { method: "GET" | "PUT" | "POST" | "DELETE"; url: string; payload?: unknown },
) {
  const headers: Record<string, string> =
    member === null ? { origin: TEST_APP_ORIGIN } : sessionHeader(member.sessionToken);
  if (call.payload !== undefined) headers["content-type"] = "application/json";
  return t.app.inject({
    method: call.method,
    url: call.url,
    headers,
    ...(call.payload === undefined ? {} : { payload: JSON.stringify(call.payload) }),
  });
}

// The URL of a route with its :id filled in.
function pathOf(route: { path: string }, id: string): string {
  return route.path.replace(":id", id);
}

// Marks these positions of a card public, as its owner (the person's first card unless another card id is given).
async function markPublic(
  member: Member,
  positions: number[],
  cardId = member.cardId,
): Promise<void> {
  await asPerson(t.db, member.personId, (trx) =>
    trx
      .updateTable("card_items")
      .set({ is_public: true })
      .where("card_id", "=", cardId)
      .where("position", "in", positions)
      .execute(),
  );
}

// Lists the person in the directory with their first card and this line, as that person; returns the listing id.
async function listMember(member: Member, line: string, isOpenToRomance = false): Promise<string> {
  const row = await asPerson(t.db, member.personId, (trx) =>
    trx
      .insertInto("directory_listings")
      .values({
        person_id: member.personId,
        card_id: member.cardId,
        line,
        open_to_romance: isOpenToRomance,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

// The curated question with this id, in the shape directMeeting takes.
function curated(id: number): { questionId: number; text: string; kind: string } {
  const row = CURATED_QUESTIONS.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error("no curated question " + String(id));
  return { questionId: row.id, text: row.text, kind: row.kind };
}

// Makes a directory meeting through directory_meeting_create as the visitor, past the route and its two caps, with a per-listing cap of 100; returns the meeting id.
async function directMeeting(
  visitor: Member,
  listingId: string,
  question: { questionId: number | null; text: string; kind: string | null },
): Promise<string> {
  const result = await asPerson(t.db, visitor.personId, (trx) =>
    sql<{
      id: string | null;
    }>`SELECT directory_meeting_create(${listingId}::uuid, ${visitor.personId}::uuid, ${visitor.cardId}::uuid, ${question.questionId}::int, ${question.text}, ${question.questionId !== null}, ${question.kind}::text, ${100}) AS id`.execute(
      trx,
    ),
  );
  const id = result.rows[0]?.id;
  if (id === null || id === undefined) throw new Error("directory_meeting_create returned no id");
  return id;
}

// A uuid anywhere in a text, in the lower-case form Postgres writes.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// Pat, listed with only item 2 public, and Quinn, a stranger who is not listed.
let pat: Member;
let patListing: string;
let quinn: Member;

beforeAll(async () => {
  pat = await seedMember("Pat Private");
  await markPublic(pat, [2]);
  patListing = await listMember(pat, "I like quiet mornings.");
  quinn = await seedMember("Quinn Viewer");
});

describe("what strangers never see", () => {
  it("W6-DAPI-T38 (P6): a stranger's directory page holds no person, card, item or turn id and no item that is not public", async () => {
    const response = await send(quinn, { method: "GET", url: routes.directory.browse.path });

    expect(response.statusCode).toBe(200);
    expect(response.body.match(UUID_PATTERN)).toEqual([patListing]);
    expect(response.body).toContain("Test claim 2");
    expect(response.body).toContain("I answer messages only after lunch.");
    for (const hidden of [
      "Test claim 1",
      "Test claim 3",
      "Test claim 4",
      "Test claim 5",
      "Test claim 6",
      "I plan the week on Sunday night and keep to it.",
      "Honest feedback matters more to me than comfort.",
      pat.personId,
      pat.cardId,
      ...pat.itemIds,
      ...pat.turnIds,
    ]) {
      expect(response.body).not.toContain(hidden);
    }
  });

  it("W6-DAPI-T39 (P3, P4, P6): the friends list and the listed meetings list carry no person id or card id", async () => {
    const m = await createPairedMeeting(t.db);
    const meetingId = await directMeeting(quinn, patListing, curated(1));

    const friends = await send(m.a, { method: "GET", url: routes.directory.friends.path });
    const listed = await send(pat, { method: "GET", url: routes.directory.listedMeetings.path });

    expect(friends.statusCode).toBe(200);
    expect(friends.body.match(UUID_PATTERN)).toEqual([m.pairId]);
    expect(listed.statusCode).toBe(200);
    expect(listed.body.match(UUID_PATTERN)).toEqual([meetingId]);
  });

  it("W6-DAPI-T40 (design section 6): every directory route answers 401 session_missing without a session, and changes nothing", async () => {
    const unauthenticated = [
      await send(null, { method: "GET", url: pathOf(routes.directory.readSharing, pat.cardId) }),
      await send(null, {
        method: "PUT",
        url: pathOf(routes.directory.updateSharing, pat.cardId),
        payload: { friendsCanAsk: true, publicPositions: [] },
      }),
      await send(null, { method: "GET", url: routes.directory.browse.path }),
      await send(null, { method: "GET", url: routes.directory.readMyListing.path }),
      await send(null, {
        method: "PUT",
        url: routes.directory.upsertMyListing.path,
        payload: { cardId: pat.cardId, line: "Hello.", openToRomance: false },
      }),
      await send(null, { method: "DELETE", url: routes.directory.leave.path }),
      await send(null, { method: "GET", url: routes.directory.listedMeetings.path }),
      await send(null, {
        method: "POST",
        url: pathOf(routes.directory.createListingMeeting, patListing),
        payload: { questionId: 1, cardId: pat.cardId },
      }),
      await send(null, { method: "GET", url: routes.directory.friends.path }),
    ];
    const listing = await asPerson(t.db, pat.personId, (trx) =>
      trx
        .selectFrom("directory_listings")
        .select("id")
        .where("person_id", "=", pat.personId)
        .execute(),
    );
    const publicItems = await asPerson(t.db, pat.personId, (trx) =>
      trx
        .selectFrom("card_items")
        .select("position")
        .where("card_id", "=", pat.cardId)
        .where("is_public", "=", true)
        .execute(),
    );

    for (const response of unauthenticated) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        code: "session_missing",
        message: "Sign in again from the start page.",
      });
    }
    expect(listing).toEqual([{ id: patListing }]);
    expect(publicItems).toEqual([{ position: 2 }]);
  });
});
