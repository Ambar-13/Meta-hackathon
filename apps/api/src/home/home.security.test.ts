import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ErrorBody,
  HomeView,
  PAIR_LIFETIME_HOURS,
  PAIR_TOKEN_BYTES,
  routes,
} from "@meet-first/contracts";
import {
  asPerson,
  createPairedMeetingWithTurns,
  createTestPerson,
  sha256Text,
} from "@meet-first/db/testing";
import { buildTestApp, TEST_APP_ORIGIN } from "../testing/app-factory.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerHomeRoutes } from "./index.js";

let t: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerHomeRoutes] });
});

afterAll(async () => {
  await t.close();
});

describe("GET /api/home privacy", () => {
  it("HOME-SEC-T1: person C's home shows none of the source, card, meetings or pairs of the people A and B", async () => {
    const seeded = await createPairedMeetingWithTurns(t.db);
    const token = randomBytes(PAIR_TOKEN_BYTES).toString("hex");
    const openPair = await asPerson(t.db, seeded.a.personId, (trx) =>
      trx
        .insertInto("pairs")
        .values({
          creator_person_id: seeded.a.personId,
          token_hash: sha256Text(token),
          expires_at: new Date(Date.now() + PAIR_LIFETIME_HOURS * 3_600_000),
        })
        .returning("id")
        .executeTakeFirstOrThrow(),
    );
    const outsider = await createTestPerson(t.db, "Outsider");
    const response = await t.app.inject({
      method: "GET",
      url: routes.people.readHome.path,
      headers: sessionHeader(outsider.sessionToken),
    });
    expect(response.statusCode).toBe(200);
    const home = HomeView.parse(JSON.parse(response.body));
    expect(home).toMatchObject({
      displayName: "Outsider",
      source: null,
      card: null,
      meetings: [],
      pairs: [],
    });
    const forbidden = [
      seeded.a.personId,
      seeded.b.personId,
      seeded.a.sourceId,
      seeded.b.sourceId,
      seeded.a.cardId,
      seeded.b.cardId,
      seeded.meetingId,
      seeded.pairId,
      openPair.id,
      "Test A",
      "Test B",
    ];
    for (const value of forbidden) {
      expect(response.body).not.toContain(value);
    }
  });

  it("HOME-SEC-T2: person A's home names B but carries no id, card, item, source or quote of B", async () => {
    const seeded = await createPairedMeetingWithTurns(t.db);
    const response = await t.app.inject({
      method: "GET",
      url: routes.people.readHome.path,
      headers: sessionHeader(seeded.a.sessionToken),
    });
    expect(response.statusCode).toBe(200);
    const home = HomeView.parse(JSON.parse(response.body));
    expect(home.meetings.map((meeting) => meeting.otherDisplayName)).toEqual(["Test B"]);
    expect(home.source?.id).toBe(seeded.a.sourceId);
    expect(home.card?.id).toBe(seeded.a.cardId);
    for (const value of [
      seeded.b.personId,
      seeded.b.sourceId,
      seeded.b.cardId,
      ...seeded.b.turnIds,
      "Deadlines are guides for me",
    ]) {
      expect(response.body).not.toContain(value);
    }
  });

  it("HOME-SEC-T3: no session gives the same 401 session_missing every other route gives", async () => {
    const response = await t.app.inject({
      method: "GET",
      url: routes.people.readHome.path,
      headers: { origin: TEST_APP_ORIGIN },
    });
    expect(response.statusCode).toBe(401);
    expect(ErrorBody.parse(JSON.parse(response.body))).toMatchObject({ code: "session_missing" });
  });
});
