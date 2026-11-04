import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorBody, MeetingCreateResponse, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import {
  createApprovedCard,
  createFrozenSource,
  createTestPerson,
  SEED_TURNS_A,
} from "@meet-first/db/testing";
import { startOfUtcDay } from "../meetings/create-meeting.js";
import { enqueuedJobs } from "../testing/app-factory.js";
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

// One request: method, URL, the session token of the person making it (none for a request without a
// session), a JSON payload or a raw string payload, and whether to leave out the Origin header.
type Call = {
  method: "GET" | "POST";
  url: string;
  token?: string;
  payload?: unknown;
  withoutOrigin?: boolean;
};

// The text a payload is sent as: a string as it is, anything else as JSON.
function payloadText(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

// Makes one request through the app's injector and returns the status, the headers and the parsed
// body.
async function send(
  call: Call,
): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (call.withoutOrigin !== true) headers.origin = ORIGIN;
  if (call.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${call.token}`;
  const payload = payloadText(call.payload);
  const response = await t.app.inject({
    method: call.method,
    url: call.url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
  };
}

// One seeded person: the session token a request sends, the approved card, and the display name.
type Person = { personId: string; sessionToken: string; cardId: string; name: string };

// Creates a person with a frozen source of the three SEED_TURNS_A turns and an approved card of 6
// items quoting them.
async function seedPerson(name: string): Promise<Person> {
  const person = await createTestPerson(t.db, name);
  const source = await createFrozenSource(t.db, person.personId, [...SEED_TURNS_A]);
  const card = await createApprovedCard(t.db, source.sourceId);
  return {
    personId: person.personId,
    sessionToken: person.sessionToken,
    cardId: card.cardId,
    name,
  };
}

// Lists the person in the directory with their first two items public, as the sharing part and the
// directory switch would, and returns the listing id.
async function listInDirectory(person: Person): Promise<string> {
  const row = await withPerson(t.db, person.personId, async (trx) => {
    await trx
      .updateTable("card_items")
      .set({ is_public: true })
      .where("card_id", "=", person.cardId)
      .where("position", "<=", 2)
      .execute();
    return trx
      .insertInto("directory_listings")
      .values({ person_id: person.personId, card_id: person.cardId, line: "I fix flaky deploys." })
      .returning("id")
      .executeTakeFirstOrThrow();
  });
  return row.id;
}

// The help text of the seeded asks; it becomes the meeting's question.
const ASK_TEXT = "Our deploys fail at night and nobody knows why.";
// The reply to every answer that cannot be met.
const NOT_MEETABLE = {
  code: "helper_not_meetable",
  message: "This person can no longer be met from these results.",
};

// Writes a help ask of the asker in the given state with one answered row for the helper, and
// returns both ids.
async function seedHelpAnswer(input: {
  asker: Person;
  helper: Person;
  listingId: string | null;
  position: number | null;
  askState?: "done" | "ranking";
  questionKind?: "help" | "romance";
}): Promise<{ askId: string; answerId: string }> {
  return withPerson(t.db, input.asker.personId, async (trx) => {
    const askState = input.askState ?? "done";
    const ask = await trx
      .insertInto("persona_asks")
      .values({
        person_id: input.asker.personId,
        mode: "help",
        text: ASK_TEXT,
        state: askState,
        finished_at: askState === "done" ? new Date() : null,
        question_kind: input.questionKind ?? "help",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const answer = await trx
      .insertInto("persona_answers")
      .values({
        ask_id: ask.id,
        asker_person_id: input.asker.personId,
        subject_person_id: input.helper.personId,
        subject_card_id: input.helper.cardId,
        listing_id: input.listingId,
        mode: "help",
        ask_text: ASK_TEXT,
        asker_display_name: input.asker.name,
        subject_display_name: input.helper.name,
        subject_line: "I fix flaky deploys.",
        shortlist_rank: 1,
        state: "answered",
        answer: `${input.helper.name}'s persona would probably read the logs first.`,
        has_sign: input.position !== null,
        claims: JSON.stringify([
          {
            text: "Reads the logs first",
            quote: SEED_TURNS_A[0],
            turnId: randomUUID(),
            verified: true,
            supported: true,
          },
        ]),
        supported_count: 1,
        position: input.position,
        answered_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { askId: ask.id, answerId: answer.id };
  });
}

// The URL of the meeting route for one answer of one ask.
function meetUrl(input: { askId: string; answerId: string }): string {
  return routes.asks.meetHelper.path
    .replace(":id", input.askId)
    .replace(":answerId", input.answerId);
}

// Posts the meeting route as one person, with that person's card unless another card id is given.
async function meet(input: {
  person: Person;
  askId: string;
  answerId: string;
  cardId?: string;
}): Promise<{ statusCode: number; body: unknown }> {
  return send({
    method: "POST",
    url: meetUrl(input),
    token: input.person.sessionToken,
    payload: { cardId: input.cardId ?? input.person.cardId },
  });
}

// The person's meeting memberships made since midnight UTC today, read as that person; with
// isPublicOnly, only those where the person was the listed side.
async function countMemberships(input: {
  personId: string;
  isPublicOnly: boolean;
}): Promise<number> {
  const rows = await withPerson(t.db, input.personId, (trx) =>
    trx
      .selectFrom("meeting_members")
      .select(["meeting_id", "public_only"])
      .where("person_id", "=", input.personId)
      .where("created_at", ">=", startOfUtcDay(new Date()))
      .execute(),
  );
  return rows.filter((row) => !input.isPublicOnly || row.public_only).length;
}

describe("POST /api/asks/:id/answers/:answerId/meeting", () => {
  it("W6-ASKA-T21 (design sections 6 and 11): meeting a placed helper makes a directory meeting on the ask's text, already checked, of kind help, with the helper public-only, and enqueues check_question", async () => {
    const asker = await seedPerson("Asker A");
    const helper = await seedPerson("Helper H");
    const listingId = await listInDirectory(helper);
    const ids = await seedHelpAnswer({ asker, helper, listingId, position: 1 });

    const response = await meet({ person: asker, ...ids });

    expect(response.statusCode).toBe(201);
    const { meetingId } = MeetingCreateResponse.parse(response.body);
    const meeting = await withPerson(t.db, asker.personId, (trx) =>
      trx
        .selectFrom("meetings")
        .select([
          "question_text",
          "question_id",
          "question_kind",
          "question_checked_at",
          "state",
          "pair_id",
        ])
        .where("id", "=", meetingId)
        .executeTakeFirstOrThrow(),
    );
    expect(meeting).toMatchObject({
      question_text: ASK_TEXT,
      question_id: null,
      question_kind: "help",
      state: "ready",
    });
    expect(meeting.question_checked_at).not.toBeNull();
    const members = await withPerson(t.db, asker.personId, (trx) =>
      trx
        .selectFrom("meeting_members")
        .select(["person_id", "side", "card_id", "public_only", "ready_at"])
        .where("meeting_id", "=", meetingId)
        .orderBy("side")
        .execute(),
    );
    expect(
      members.map((member) => ({
        person_id: member.person_id,
        side: member.side,
        card_id: member.card_id,
        public_only: member.public_only,
      })),
    ).toEqual([
      { person_id: asker.personId, side: "a", card_id: asker.cardId, public_only: false },
      { person_id: helper.personId, side: "b", card_id: helper.cardId, public_only: true },
    ]);
    expect(members.every((member) => member.ready_at !== null)).toBe(true);
    const pair = await withPerson(t.db, asker.personId, (trx) =>
      trx
        .selectFrom("pairs")
        .select(["via_directory", "creator_person_id", "joiner_person_id"])
        .where("id", "=", meeting.pair_id)
        .executeTakeFirstOrThrow(),
    );
    expect(pair).toEqual({
      via_directory: true,
      creator_person_id: asker.personId,
      joiner_person_id: helper.personId,
    });
    expect(enqueuedJobs(t.app).at(-1)).toEqual({ name: "check_question", payload: { meetingId } });
  });

  it("W6-ASKA-T22 (design section 6): an answer that cannot be met gives 409 helper_not_meetable and makes no meeting", async () => {
    const asker = await seedPerson("Asker A");
    const stranger = await seedPerson("Stranger X");
    const one = await seedPerson("Helper One");
    const two = await seedPerson("Helper Two");
    const three = await seedPerson("Helper Three");
    const four = await seedPerson("Helper Four");
    const five = await seedPerson("Helper Five");
    const oneListing = await listInDirectory(one);
    const twoListing = await listInDirectory(two);
    const threeListing = await listInDirectory(three);
    const fourListing = await listInDirectory(four);
    const fiveListing = await listInDirectory(five);
    const unplaced = await seedHelpAnswer({
      asker,
      helper: one,
      listingId: oneListing,
      position: null,
    });
    const fourth = await seedHelpAnswer({ asker, helper: two, listingId: twoListing, position: 4 });
    const ranking = await seedHelpAnswer({
      asker,
      helper: three,
      listingId: threeListing,
      position: 1,
      askState: "ranking",
    });
    const left = await seedHelpAnswer({ asker, helper: four, listingId: fourListing, position: 1 });
    await withPerson(t.db, four.personId, (trx) =>
      trx.deleteFrom("directory_listings").where("person_id", "=", four.personId).execute(),
    );
    const leftRow = await withPerson(t.db, asker.personId, (trx) =>
      trx
        .selectFrom("persona_answers")
        .select("listing_id")
        .where("id", "=", left.answerId)
        .executeTakeFirstOrThrow(),
    );
    expect(leftRow.listing_id).toBeNull();
    const good = await seedHelpAnswer({ asker, helper: five, listingId: fiveListing, position: 1 });

    const refusals = [
      await meet({ person: asker, ...unplaced }),
      await meet({ person: asker, ...fourth }),
      await meet({ person: asker, ...ranking }),
      await meet({ person: asker, ...left }),
      await meet({ person: asker, askId: unplaced.askId, answerId: good.answerId }),
      await meet({ person: stranger, ...good }),
    ];

    for (const refusal of refusals) {
      expect(refusal.statusCode).toBe(409);
      expect(ErrorBody.parse(refusal.body)).toEqual(NOT_MEETABLE);
    }
    expect(await countMemberships({ personId: asker.personId, isPublicOnly: false })).toBe(0);
    expect(await countMemberships({ personId: stranger.personId, isPublicOnly: false })).toBe(0);
    const accepted = await meet({ person: asker, ...good });
    expect(accepted.statusCode).toBe(201);
    expect(await countMemberships({ personId: asker.personId, isPublicOnly: false })).toBe(1);
  });

  it("W6-ASKA-T23 (design section 5, D60): the asker's sixth meeting of a UTC day gives 429 meeting_daily_cap", async () => {
    const asker = await seedPerson("Asker A");
    const helper = await seedPerson("Helper H");
    const listingId = await listInDirectory(helper);
    const ids = await seedHelpAnswer({ asker, helper, listingId, position: 1 });
    const meetingIds: string[] = [];
    const replies: Array<{ statusCode: number; body: unknown }> = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const reply = await meet({ person: asker, ...ids });
      replies.push(reply);
      if (reply.statusCode === 201)
        meetingIds.push(MeetingCreateResponse.parse(reply.body).meetingId);
    }

    expect(replies.slice(0, 5).map((reply) => reply.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(replies[5]?.statusCode).toBe(429);
    expect(ErrorBody.parse(replies[5]?.body)).toEqual({
      code: "meeting_daily_cap",
      message: "You have been in 5 meetings today. Try again tomorrow.",
    });
    expect(await countMemberships({ personId: asker.personId, isPublicOnly: false })).toBe(5);
    const checked = enqueuedJobs(t.app).filter(
      (job) =>
        job.name === "check_question" &&
        meetingIds.includes((job.payload as { meetingId: string }).meetingId),
    );
    expect(checked).toHaveLength(5);
  });

  it("W6-ASKA-T24 (design section 5): the helper's eleventh directory meeting of a UTC day gives 429 directory_daily_cap with the database sentence", async () => {
    const helper = await seedPerson("Helper H");
    const listingId = await listInDirectory(helper);
    const askerOne = await seedPerson("Asker One");
    const askerTwo = await seedPerson("Asker Two");
    const askerThree = await seedPerson("Asker Three");
    const idsOne = await seedHelpAnswer({ asker: askerOne, helper, listingId, position: 1 });
    const idsTwo = await seedHelpAnswer({ asker: askerTwo, helper, listingId, position: 1 });
    const idsThree = await seedHelpAnswer({ asker: askerThree, helper, listingId, position: 1 });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1)
      statuses.push((await meet({ person: askerOne, ...idsOne })).statusCode);
    for (let attempt = 0; attempt < 5; attempt += 1)
      statuses.push((await meet({ person: askerTwo, ...idsTwo })).statusCode);

    const eleventh = await meet({ person: askerThree, ...idsThree });

    expect(statuses).toEqual([201, 201, 201, 201, 201, 201, 201, 201, 201, 201]);
    expect(eleventh.statusCode).toBe(429);
    expect(ErrorBody.parse(eleventh.body)).toEqual({
      code: "directory_daily_cap",
      message: "this persona has met as many people as it can today. Try again tomorrow.",
    });
    expect(await countMemberships({ personId: helper.personId, isPublicOnly: true })).toBe(10);
    expect(await countMemberships({ personId: askerThree.personId, isPublicOnly: false })).toBe(0);
  });

  it("W6-ASKA-T25 (design section 6): a card that is not the caller's approved card gives 409 card_not_approved with the database sentence", async () => {
    const asker = await seedPerson("Asker A");
    const helper = await seedPerson("Helper H");
    const listingId = await listInDirectory(helper);
    const ids = await seedHelpAnswer({ asker, helper, listingId, position: 1 });

    const unknownCard = await meet({ person: asker, ...ids, cardId: randomUUID() });
    const helperCard = await meet({ person: asker, ...ids, cardId: helper.cardId });

    for (const refusal of [unknownCard, helperCard]) {
      expect(refusal.statusCode).toBe(409);
      expect(ErrorBody.parse(refusal.body)).toEqual({
        code: "card_not_approved",
        message: "approve your card before creating a meeting.",
      });
    }
    expect(await countMemberships({ personId: asker.personId, isPublicOnly: false })).toBe(0);
  });

  it("W6-ASKA-T26 (design section 6): a body without a card id is 400 payload_invalid and an id that is not a uuid is 404 not_found", async () => {
    const asker = await seedPerson("Asker A");
    const helper = await seedPerson("Helper H");
    const listingId = await listInDirectory(helper);
    const ids = await seedHelpAnswer({ asker, helper, listingId, position: 1 });

    const noCard = await send({
      method: "POST",
      url: meetUrl(ids),
      token: asker.sessionToken,
      payload: {},
    });
    expect(noCard.statusCode).toBe(400);
    expect(ErrorBody.parse(noCard.body)).toEqual({
      code: "payload_invalid",
      message: "The request body did not match the expected shape. Reload and try again.",
    });

    const badAsk = await meet({ person: asker, askId: "not-a-uuid", answerId: ids.answerId });
    const badAnswer = await meet({ person: asker, askId: ids.askId, answerId: "not-a-uuid" });
    for (const response of [badAsk, badAnswer]) {
      expect(response.statusCode).toBe(404);
      expect(ErrorBody.parse(response.body)).toEqual({
        code: "not_found",
        message: "This no longer exists or is not yours.",
      });
    }
    expect(await countMemberships({ personId: asker.personId, isPublicOnly: false })).toBe(0);
  });

  it("W6-ASKA-T45 (design section 11, P8, as-built item 57): meeting a helper from a dating ask makes a romance meeting, and is refused once the helper's dating switch is off", async () => {
    const asker = await seedPerson("Asker A");
    const helper = await seedPerson("Helper H");
    const listingId = await listInDirectory(helper);
    const ids = await seedHelpAnswer({
      asker,
      helper,
      listingId,
      position: 1,
      questionKind: "romance",
    });

    const refused = await meet({ person: asker, ...ids });

    expect(refused.statusCode).toBe(409);
    expect(ErrorBody.parse(refused.body)).toEqual({
      code: "romance_not_open",
      message: "this person has not opened their persona to dating questions.",
    });
    expect(await countMemberships({ personId: asker.personId, isPublicOnly: false })).toBe(0);
    await withPerson(t.db, helper.personId, (trx) =>
      trx
        .updateTable("directory_listings")
        .set({ open_to_romance: true })
        .where("id", "=", listingId)
        .execute(),
    );
    const accepted = await meet({ person: asker, ...ids });
    expect(accepted.statusCode).toBe(201);
    const { meetingId } = MeetingCreateResponse.parse(accepted.body);
    const meeting = await withPerson(t.db, asker.personId, (trx) =>
      trx
        .selectFrom("meetings")
        .select(["question_kind", "romance_allowed"])
        .where("id", "=", meetingId)
        .executeTakeFirstOrThrow(),
    );
    expect(meeting).toEqual({ question_kind: "romance", romance_allowed: true });
  });
});
