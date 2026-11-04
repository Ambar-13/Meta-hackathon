import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AVATARS,
  COMIC_PANELS,
  ConsentResponse,
  CommittedEvent,
  ContractError,
  ErrorBody,
  EVENT_VERSION,
  eventToPayload,
  FORBIDDEN_SHARE_KEYS,
  routes,
  ShareSnapshot,
  apiEnv,
  type BriefPoint,
  type Enqueue,
} from "@meet-first/contracts";
import { makeDatabase, withMeeting, withPerson, type Database } from "@meet-first/db";
import {
  createPairedMeetingWithTurns,
  readTestDatabaseUrls,
  type SeededMeeting,
} from "@meet-first/db/testing";
import { buildApp } from "../server.js";
import { buildTestApp } from "../testing/index.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerShareRoutes } from "./index.js";
import { assertNoForbiddenKeys, buildShareSnapshot, isShareableLine } from "./snapshot.js";
import { readSharePage } from "./read-share-page.js";

// The fixed time every seeded event carries.
const EVENT_AT = "2026-10-26T12:00:00.000Z";
// The text of the lines the snapshot must show, in the order it must show them.
const SHOWN_AGREE = ["Both plan before big meetings", "Agree line B"];
const SHOWN_CLASH = ["Clash line A", "Clash line B"];
const SHOWN_DECIDE_FIRST = ["Decide first A", "Decide first B"];
// The texts of the brief lines the snapshot must never show.
const HIDDEN_LINES = [
  "Unsupported line A",
  "Null judged line A",
  "Unverified quote line A",
  "Unsupported line B",
];

// The shared app kit and the worker connection that writes the seed.
let kit: Awaited<ReturnType<typeof buildTestApp>>;
let workerDb: Kysely<Database>;
let seeded: SeededMeeting;
let meetingId: string;
let slug: string;

// The fields of one brief point in this file: its text, the side and turn of its one quote, its
// verdict, and whether the quote was found.
type PointInput = {
  text: string;
  side: "a" | "b";
  turnId: string;
  supported: boolean | null;
  verified?: boolean;
};
// One brief point with one quote from the given side and turn.
function point(input: PointInput): BriefPoint {
  return {
    text: input.text,
    quotes: [
      {
        text: `quote for ${input.text}`,
        side: input.side,
        turnId: input.turnId,
        verified: input.verified ?? true,
      },
    ],
    supported: input.supported,
  };
}

// The first turn id of one side, read once with a message if the seed has none.
function firstTurn(side: SeededMeeting["a"]): string {
  const turnId = side.turnIds[0];
  if (turnId === undefined) throw new Error("the seed has no turn for this side");
  return turnId;
}

// The four committed turns, with two claims each (one verified, one flagged), then phase, end and
// brief.ready at seq 7.
function seedEvents(seed: SeededMeeting): CommittedEvent[] {
  const turns = [seed.a.turnIds, seed.b.turnIds];
  const sides = ["a", "b", "a", "b"] as const;
  const turnEvents: CommittedEvent[] = sides.map((side, index) => {
    const turnId = turns[index % 2]?.[0] ?? "";
    const number = index + 1;
    return {
      v: EVENT_VERSION,
      meetingId: seed.meetingId,
      at: EVENT_AT,
      seq: number,
      type: "turn.committed",
      stepSeq: number,
      side,
      phase: "explore",
      text: `Plain turn text number ${String(number)}.`,
      claims: [
        {
          id: randomUUID(),
          side,
          position: 1,
          text: `Verified claim ${String(number)}`,
          quote: `verified quote ${String(number)}`,
          lang: "en",
          turnId,
          verified: true,
          flagged: false,
          evidenceValid: true,
        },
        {
          id: randomUUID(),
          side,
          position: 2,
          text: `Flagged claim ${String(number)}`,
          quote: `flagged quote ${String(number)}`,
          lang: "en",
          turnId,
          verified: false,
          flagged: true,
          evidenceValid: false,
        },
      ],
    };
  });
  return [
    ...turnEvents,
    {
      v: EVENT_VERSION,
      meetingId: seed.meetingId,
      at: EVENT_AT,
      seq: 5,
      type: "phase.changed",
      phase: "close",
      stepSeq: 4,
    },
    {
      v: EVENT_VERSION,
      meetingId: seed.meetingId,
      at: EVENT_AT,
      seq: 6,
      type: "meeting.ended",
      reason: "decided",
      endedAt: EVENT_AT,
    },
    {
      v: EVENT_VERSION,
      meetingId: seed.meetingId,
      at: EVENT_AT,
      seq: 7,
      type: "brief.ready",
      supportRate: { a: 0.5, b: null },
    },
  ];
}

// Moves the meeting from ready to running to ended, as the meeting jobs do.
async function endMeeting(id: string): Promise<void> {
  await withMeeting(workerDb, id, async (trx) => {
    await trx
      .updateTable("meetings")
      .set({ state: "running", started_at: new Date(), ends_at: new Date() })
      .where("id", "=", id)
      .execute();
    await trx
      .updateTable("meetings")
      .set({ state: "ended", ended_at: new Date(), end_reason: "decided" })
      .where("id", "=", id)
      .execute();
  });
}

// Writes the events above in order, through the worker connection, as the meeting jobs write them.
async function writeEvents(seed: SeededMeeting): Promise<void> {
  await withMeeting(workerDb, seed.meetingId, async (trx) => {
    for (const event of seedEvents(seed)) {
      await trx
        .insertInto("meeting_events")
        .values({
          meeting_id: event.meetingId,
          seq: event.seq,
          type: event.type,
          v: event.v,
          payload: JSON.stringify(eventToPayload(event)),
          created_at: event.at,
        })
        .execute();
    }
  });
}

// Writes both briefs: side a's has a supported line, an unsupported line, a null line and an
// unverified quote; side b's shares one line with side a.
async function writeBriefs(seed: SeededMeeting): Promise<void> {
  const turnA = firstTurn(seed.a);
  const turnB = firstTurn(seed.b);
  const briefA = {
    agree: [
      point({ text: "Both plan before big meetings", side: "a", turnId: turnA, supported: true }),
      point({ text: "Unsupported line A", side: "a", turnId: turnA, supported: false }),
      point({ text: "Null judged line A", side: "a", turnId: turnA, supported: null }),
    ],
    clash: [
      point({
        text: "Unverified quote line A",
        side: "a",
        turnId: turnA,
        supported: true,
        verified: false,
      }),
      point({ text: "Clash line A", side: "a", turnId: turnA, supported: true }),
    ],
    decide_first: [point({ text: "Decide first A", side: "a", turnId: turnA, supported: true })],
  };
  const briefB = {
    agree: [
      point({ text: "Both plan before big meetings", side: "b", turnId: turnB, supported: true }),
      point({ text: "Agree line B", side: "b", turnId: turnB, supported: true }),
    ],
    clash: [point({ text: "Clash line B", side: "b", turnId: turnB, supported: true })],
    decide_first: [
      point({ text: "Unsupported line B", side: "b", turnId: turnB, supported: false }),
      point({ text: "Decide first B", side: "b", turnId: turnB, supported: true }),
    ],
  };
  await withMeeting(workerDb, seed.meetingId, async (trx) => {
    for (const [personId, brief] of [
      [seed.a.personId, briefA],
      [seed.b.personId, briefB],
    ] as const) {
      await trx
        .insertInto("briefs")
        .values({
          meeting_id: seed.meetingId,
          person_id: personId,
          agree: JSON.stringify(brief.agree),
          clash: JSON.stringify(brief.clash),
          decide_first: JSON.stringify(brief.decide_first),
          model: "test-model",
          prompt_version: "test",
        })
        .execute();
    }
  });
}

// Writes one unverified card item for side a: approved but not verified, so the snapshot must leave
// it out.
async function writeUnverifiedItem(seed: SeededMeeting): Promise<void> {
  await withPerson(workerDb, seed.a.personId, async (trx) => {
    const position = 7;
    await trx
      .insertInto("card_items")
      .values({
        card_id: seed.a.cardId,
        person_id: seed.a.personId,
        position,
        kind: "habit",
        claim: "Unverified item for side a",
        lang: "en",
        gloss: "test gloss",
        turn_id: firstTurn(seed.a),
        quote: "a quote that is not in the turn",
        norm_quote: "a quote that is not in the turn",
        verified: false,
        flagged: true,
        approved: true,
      })
      .execute();
  });
}

// Writes a ready comic with six small panels for the meeting.
async function writeComic(seed: SeededMeeting): Promise<void> {
  await withMeeting(workerDb, seed.meetingId, async (trx) => {
    const comic = await trx
      .insertInto("comics")
      .values({
        meeting_id: seed.meetingId,
        requested_by: seed.a.personId,
        state: "ready",
        avatar_a: AVATARS[0],
        avatar_b: AVATARS[1],
        prompt_version: "test",
        purge_after: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (let position = 1; position <= COMIC_PANELS; position += 1) {
      await trx
        .insertInto("comic_panels")
        .values({
          comic_id: comic.id,
          meeting_id: seed.meetingId,
          position,
          caption: `Panel ${String(position)} caption`,
          image_prompt: "test prompt",
          image: Buffer.from("RIFF test panel"),
        })
        .execute();
    }
  });
}

// Makes one request as a person who holds a session token, and returns the reply.
function consentRequest(method: "POST" | "DELETE", id: string, sessionToken: string) {
  return kit.app.inject({
    method,
    url: routes.briefs.consent.path.replace(":id", id),
    headers: sessionHeader(sessionToken),
  });
}

// Every key of a value at any depth, for the recursive key walk.
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => allKeys(item));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

// The error code a thrown ContractError carries, or the empty text for any other thrown value.
function codeOf(run: () => void): string {
  try {
    run();
    return "";
  } catch (error: unknown) {
    return error instanceof ContractError ? error.code : "";
  }
}

beforeAll(async () => {
  kit = await buildTestApp({ routes: [registerShareRoutes] });
  workerDb = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, 2);
  seeded = await createPairedMeetingWithTurns(kit.db, { questionId: 3 });
  meetingId = seeded.meetingId;
  await endMeeting(meetingId);
  await writeEvents(seeded);
  await writeBriefs(seeded);
  await writeUnverifiedItem(seeded);
  await writeComic(seeded);
  const first = await consentRequest("POST", meetingId, seeded.a.sessionToken);
  expect(first.statusCode).toBe(200);
  const second = await consentRequest("POST", meetingId, seeded.b.sessionToken);
  expect(second.statusCode).toBe(200);
  const body = ConsentResponse.parse(JSON.parse(second.body) as unknown);
  slug = body.slug ?? "";
});

afterAll(async () => {
  await workerDb.destroy();
  await kit.close();
});

describe("share snapshot security", () => {
  it("W2-SHARE-T1 (R9.4, invariant 13): the serializer output has none of the forbidden keys at any depth", async () => {
    const snapshot = await withMeeting(kit.db, meetingId, (trx) =>
      buildShareSnapshot(trx, meetingId),
    );
    const keys = allKeys(snapshot);
    expect(keys.filter((key) => (FORBIDDEN_SHARE_KEYS as readonly string[]).includes(key))).toEqual(
      [],
    );
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain(seeded.a.personId);
    expect(text).not.toContain(seeded.b.personId);
    expect(text).not.toContain(seeded.pairId);
    expect(
      codeOf(() => {
        assertNoForbiddenKeys({ a: { email: "x" } });
      }),
    ).toBe("share_snapshot_forbidden_key");
  });

  it("W2-SHARE-T2 (A1, invariant 19, R6.5): unsupported brief lines, null lines, lines with an unverified quote, and flagged claims are absent from the snapshot", async () => {
    const snapshot = await withMeeting(kit.db, meetingId, (trx) =>
      buildShareSnapshot(trx, meetingId),
    );
    expect(snapshot.brief.agree.map((line) => line.text)).toEqual(SHOWN_AGREE);
    expect(snapshot.brief.clash.map((line) => line.text)).toEqual(SHOWN_CLASH);
    expect(snapshot.brief.decideFirst.map((line) => line.text)).toEqual(SHOWN_DECIDE_FIRST);
    const shown = [
      ...snapshot.brief.agree,
      ...snapshot.brief.clash,
      ...snapshot.brief.decideFirst,
    ].map((line) => line.text);
    for (const hidden of HIDDEN_LINES) expect(shown).not.toContain(hidden);
    for (const turn of snapshot.turns) {
      expect(turn.claims.every((claim) => claim.text.startsWith("Verified claim"))).toBe(true);
    }
    expect(snapshot.turns).toHaveLength(4);
    expect(snapshot.turns.flatMap((turn) => turn.claims)).toHaveLength(4);
    expect(snapshot.items.map((item) => item.claim)).not.toContain("Unverified item for side a");
    expect(snapshot.items).toHaveLength(12);
  });

  it("W2-SHARE-T2b (A1): isShareableLine is true only for a supported line whose every quote is verified", () => {
    const turn = "00000000-0000-4000-8000-000000000001";
    expect(isShareableLine(point({ text: "ok", side: "a", turnId: turn, supported: true }))).toBe(
      true,
    );
    expect(
      isShareableLine(point({ text: "unsupported", side: "a", turnId: turn, supported: false })),
    ).toBe(false);
    expect(isShareableLine(point({ text: "null", side: "a", turnId: turn, supported: null }))).toBe(
      false,
    );
    expect(
      isShareableLine(
        point({ text: "unverified", side: "a", turnId: turn, supported: true, verified: false }),
      ),
    ).toBe(false);
  });

  it("W2-SHARE-T3 (D68): the public route sends Cache-Control no-store and no Set-Cookie", async () => {
    const ok = await kit.app.inject({
      method: "GET",
      url: routes.briefs.readShare.path.replace(":slug", slug),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.headers["referrer-policy"]).toBe("no-referrer");
    expect(ok.headers["set-cookie"]).toBeUndefined();
    const missing = await kit.app.inject({
      method: "GET",
      url: routes.briefs.readShare.path.replace(":slug", "A".repeat(22)),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
    expect(missing.headers["set-cookie"]).toBeUndefined();
    expect(ErrorBody.parse(JSON.parse(missing.body) as unknown).code).toBe("share_not_found");
  });

  it("W2-SHARE-T4 (R9.4): a malformed slug is 404 without a database call, using a fake db", async () => {
    let touches = 0;
    const fakeDb = new Proxy(
      {},
      {
        get: () => {
          touches += 1;
          throw new Error("the fake database was touched");
        },
      },
    ) as unknown as Kysely<Database>;
    const enqueue: Enqueue = () => Promise.resolve();
    const env = apiEnv.parse({
      DATABASE_URL_API: "postgres://app_api@localhost:1/unused",
      APP_ORIGIN: "http://localhost:3000",
    });
    const app = await buildApp(
      { db: fakeDb, env, now: () => new Date(), enqueue },
      { routes: [registerShareRoutes] },
    );
    try {
      const reply = await app.inject({
        method: "GET",
        url: routes.briefs.readShare.path.replace(":slug", "not-a-slug"),
      });
      expect(reply.statusCode).toBe(404);
      expect(ErrorBody.parse(JSON.parse(reply.body) as unknown).code).toBe("share_not_found");
      expect(await readSharePage(fakeDb, "not-a-slug")).toBeNull();
      expect(touches).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("W2-SHARE-T4b (D68): the public read answers the stored snapshot, and it parses as ShareSnapshot", async () => {
    const snapshot = await readSharePage(kit.db, slug);
    expect(snapshot).not.toBeNull();
    expect(ShareSnapshot.parse(snapshot).comic).toHaveLength(COMIC_PANELS);
  });
});
