import { AVATARS, type BriefPoint } from "@meet-first/contracts";
import {
  makeDatabase,
  numberFromPostgres,
  POOL_SIZE,
  withMeeting,
  type Database,
} from "@meet-first/db";
import {
  createPairedMeetingWithTurns,
  freshTestDatabase,
  type TestDatabase,
} from "@meet-first/db/testing";
import { requestHash, type LiveCaller, type LlmRequest } from "@meet-first/llm";
import { sql, type Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendMeetingEvent } from "../meetings/index.js";
import { loadRecordedReply, makeTestJobContext } from "../testing/index.js";
import { renderComicTask } from "./render-comic-job.js";

// The largest stored panel in bytes.
const PANEL_CAP_BYTES = 153_600;
// One ledger estimate per image call.
const IMAGE_EST_TOKENS = 1_000;

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
beforeEach(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});
afterEach(async () => {
  vi.useRealTimers();
  await workerDb.destroy();
  await fresh.drop();
});

// The ids a seeded comic case gives: the meeting, the comic row and the two people.
type Seed = {
  meetingId: string;
  comicId: string;
  personA: string;
  personB: string;
  turnA: string;
  turnB: string;
};

// One brief point with one verified quote.
function point(text: string, supported: boolean | null, turnId: string): BriefPoint {
  return {
    text,
    supported,
    quotes: [{ text: "a quote from the meeting", side: "a", turnId, verified: true }],
  };
}

// One brief point the support check refused, whose quote did not verify.
function refusedPoint(text: string, turnId: string): BriefPoint {
  return {
    text,
    supported: false,
    quotes: [{ text: "a quote from the meeting", side: "a", turnId, verified: false }],
  };
}

// The brief of one side: three lines in each of the three groups, with the display names in the
// text.
function briefOf(
  turnId: string,
  names: { mine: string; other: string },
): { agree: BriefPoint[]; clash: BriefPoint[]; decide_first: BriefPoint[] } {
  return {
    agree: [
      point(`${names.mine} and ${names.other} both want clear owners.`, true, turnId),
      point("Weekly check-ins suit both sides.", true, turnId),
      point(`${names.other} reads plans before meetings.`, null, turnId),
    ],
    clash: [
      point(`${names.mine} wants a written plan first.`, true, turnId),
      point(`Deadlines feel firm to ${names.other}.`, true, turnId),
      refusedPoint(`${names.mine} would rather decide late.`, turnId),
    ],
    decide_first: [
      point("Who owns the first deadline.", true, turnId),
      point("How often to check in.", true, turnId),
      point("Whether plans stay on paper.", true, turnId),
    ],
  };
}

// Seeds one ended meeting with both briefs and a rendering comic, and optionally the brief.ready
// event.
async function seedEndedMeeting(options: { withBriefReady: boolean }): Promise<Seed> {
  const meeting = await createPairedMeetingWithTurns(fresh.db);
  const now = new Date();
  const turnA = meeting.a.turnIds[0] ?? "";
  const turnB = meeting.b.turnIds[0] ?? "";
  const seed = await withMeeting(workerDb, meeting.meetingId, async (trx) => {
    // A meeting moves ready, running, ended (migration 0001); the seed walks the same path the
    // meeting engine does.
    const started = new Date(now.getTime() - 600_000);
    await trx
      .updateTable("meetings")
      .set({
        state: "running",
        phase: "open",
        started_at: started,
        ends_at: now,
        current_step_seq: 9,
      })
      .where("id", "=", meeting.meetingId)
      .execute();
    await trx
      .updateTable("meetings")
      .set({ state: "ended", phase: "close", end_reason: "decided", ended_at: now })
      .where("id", "=", meeting.meetingId)
      .execute();
    const briefA = briefOf(turnA, { mine: "Test A", other: "Test B" });
    const briefB = briefOf(turnB, { mine: "Test B", other: "Test A" });
    await trx
      .insertInto("briefs")
      .values([
        {
          meeting_id: meeting.meetingId,
          person_id: meeting.a.personId,
          agree: JSON.stringify(briefA.agree),
          clash: JSON.stringify(briefA.clash),
          decide_first: JSON.stringify(briefA.decide_first),
          model: "muse-spark-1.3",
          prompt_version: "v1",
        },
        {
          meeting_id: meeting.meetingId,
          person_id: meeting.b.personId,
          agree: JSON.stringify(briefB.agree),
          clash: JSON.stringify(briefB.clash),
          decide_first: JSON.stringify(briefB.decide_first),
          model: "muse-spark-1.3",
          prompt_version: "v1",
        },
      ])
      .execute();
    if (options.withBriefReady) {
      await appendMeetingEvent(trx, {
        meetingId: meeting.meetingId,
        type: "brief.ready",
        fields: { supportRate: { a: null, b: null } },
        at: now,
      });
    }
    const comic = await trx
      .insertInto("comics")
      .values({
        meeting_id: meeting.meetingId,
        requested_by: meeting.a.personId,
        state: "rendering",
        avatar_a: AVATARS[0],
        avatar_b: AVATARS[1],
        prompt_version: "v1",
        purge_after: new Date(now.getTime() + 30 * 86_400_000),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return comic.id;
  });
  return {
    meetingId: meeting.meetingId,
    comicId: seed,
    personA: meeting.a.personId,
    personB: meeting.b.personId,
    turnA,
    turnB,
  };
}

// The stored panel rows of a comic, in position order, with the size of each image.
async function readPanels(
  seed: Seed,
): Promise<Array<{ position: number; image_prompt: string; size: number; caption: string }>> {
  return withMeeting(workerDb, seed.meetingId, (trx) =>
    trx
      .selectFrom("comic_panels")
      .select(["position", "image_prompt", "caption", sql<number>`octet_length(image)`.as("size")])
      .where("comic_id", "=", seed.comicId)
      .orderBy("position", "asc")
      .execute(),
  ).then((rows) =>
    rows.map((row) => ({
      position: row.position,
      image_prompt: row.image_prompt,
      caption: row.caption,
      size: numberFromPostgres(row.size),
    })),
  );
}

// The comic row as the job left it.
async function readComic(seed: Seed): Promise<{ state: string; finished_at: Date | null }> {
  return withMeeting(workerDb, seed.meetingId, (trx) =>
    trx
      .selectFrom("comics")
      .select(["state", "finished_at"])
      .where("id", "=", seed.comicId)
      .executeTakeFirstOrThrow(),
  );
}

// The comic events of a meeting, in seq order: the type, its seq and its reason when it is a skip.
async function comicEvents(
  seed: Seed,
): Promise<Array<{ type: string; seq: number; reason: string | null }>> {
  return withMeeting(workerDb, seed.meetingId, (trx) =>
    trx
      .selectFrom("meeting_events")
      .select(["type", "seq", "payload"])
      .where("meeting_id", "=", seed.meetingId)
      .where("type", "in", ["brief.ready", "comic.ready", "comic.skipped"])
      .orderBy("seq", "asc")
      .execute(),
  ).then((rows) =>
    rows.map((row) => ({
      type: row.type,
      seq: row.seq,
      reason: typeof row.payload.reason === "string" ? row.payload.reason : null,
    })),
  );
}

// A live caller for the job test: the recorded reply of every call, except the ones a test
// overrides. Overrides return a reply, or "never" for a call that does not come back.
function replayingLive(
  override: (request: LlmRequest) => Record<string, unknown> | "never" | undefined,
): LiveCaller {
  return async (request) => {
    const chosen = override(request);
    if (chosen === "never") return new Promise<never>(() => undefined);
    const response =
      chosen ?? loadRecordedReply(request.callSite, requestHash(request.body)).response;
    return {
      response,
      usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 },
      requestId: null,
      httpStatus: 200,
    };
  };
}

// A reply that is not an image: text in the place of webp bytes.
function notAnImage(): Record<string, unknown> {
  return { data: [{ b64_json: Buffer.from("this is text, not an image").toString("base64") }] };
}

describe("render_comic job", () => {
  it("W2-COMIC-T7 (R11.1, D64): six panels are stored in one transaction with state ready, or none with state failed", async () => {
    const seed = await seedEndedMeeting({ withBriefReady: true });
    const { context } = makeTestJobContext({ db: workerDb });
    await renderComicTask({ comicId: seed.comicId, meetingId: seed.meetingId }, context);
    const panels = await readPanels(seed);
    expect(panels).toHaveLength(6);
    for (const panel of panels) expect(panel.size).toBeLessThanOrEqual(PANEL_CAP_BYTES);
    const row = await readComic(seed);
    expect(row.state).toBe("ready");
    expect(row.finished_at).not.toBeNull();
    expect((await comicEvents(seed)).filter((event) => event.type === "comic.ready")).toHaveLength(
      1,
    );

    const failing = await seedEndedMeeting({ withBriefReady: true });
    const live = replayingLive((request) =>
      request.callSite === "comic_image" && String(request.body.prompt).includes("Panel 3 of 6")
        ? notAnImage()
        : undefined,
    );
    const failingContext = makeTestJobContext({ db: workerDb, live }).context;
    await renderComicTask(
      { comicId: failing.comicId, meetingId: failing.meetingId },
      failingContext,
    );
    expect(await readPanels(failing)).toHaveLength(0);
    expect(await readComic(failing)).toMatchObject({ state: "failed" });
    expect(
      (await comicEvents(failing))
        .filter((event) => event.type === "comic.skipped")
        .map((event) => event.reason),
    ).toEqual(["render_failed"]);
  });

  it("W2-COMIC-T8 (R11.2, D64): the 60 s deadline yields comic.skipped with reason deadline, using a fake clock and a fake slow image call and says so", async () => {
    const seed = await seedEndedMeeting({ withBriefReady: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const imageCalls: LlmRequest[] = [];
    const live = replayingLive((request) => {
      if (request.callSite !== "comic_image") return undefined;
      imageCalls.push(request);
      return "never";
    });
    const { context } = makeTestJobContext({ db: workerDb, live });
    const running = renderComicTask({ comicId: seed.comicId, meetingId: seed.meetingId }, context);
    for (let round = 0; round < 500 && imageCalls.length < 6; round += 1)
      await new Promise((resolve) => setImmediate(resolve));
    vi.advanceTimersByTime(60_000);
    await running;
    vi.useRealTimers();
    expect(await readComic(seed)).toMatchObject({ state: "skipped" });
    expect(
      (await comicEvents(seed))
        .filter((event) => event.type === "comic.skipped")
        .map((event) => event.reason),
    ).toEqual(["deadline"]);
    expect(await readPanels(seed)).toHaveLength(0);
  });

  it("W2-COMIC-T9 (R11.2): comic.ready arrives after brief.ready in the event log", async () => {
    const seed = await seedEndedMeeting({ withBriefReady: true });
    const { context } = makeTestJobContext({ db: workerDb });
    await renderComicTask({ comicId: seed.comicId, meetingId: seed.meetingId }, context);
    const events = await comicEvents(seed);
    const briefSeq = events.find((event) => event.type === "brief.ready")?.seq ?? 0;
    const readySeq = events.find((event) => event.type === "comic.ready")?.seq ?? 0;
    expect(readySeq).toBeGreaterThan(briefSeq);

    const withoutBrief = await seedEndedMeeting({ withBriefReady: false });
    const { context: noBriefContext } = makeTestJobContext({ db: workerDb });
    await renderComicTask(
      { comicId: withoutBrief.comicId, meetingId: withoutBrief.meetingId },
      noBriefContext,
    );
    expect(
      (await comicEvents(withoutBrief))
        .filter((event) => event.type === "comic.skipped")
        .map((event) => event.reason),
    ).toEqual(["brief_not_ready"]);
    expect(await readComic(withoutBrief)).toMatchObject({ state: "skipped" });
  });

  it("W2-COMIC-T10 (R11.4): the limiter counts each image call at 1,000 tokens", async () => {
    const seed = await seedEndedMeeting({ withBriefReady: true });
    const { context } = makeTestJobContext({ db: workerDb });
    await renderComicTask({ comicId: seed.comicId, meetingId: seed.meetingId }, context);
    const rows = await withMeeting(workerDb, seed.meetingId, (trx) =>
      trx
        .selectFrom("ledger")
        .select(["call_site", "est_tokens", "meeting_id"])
        .where("call_site", "=", "comic_image")
        .execute(),
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.est_tokens).toBe(IMAGE_EST_TOKENS);
      expect(row.meeting_id).toBe(seed.meetingId);
    }
  });

  it("W2-COMIC-T11 (D65): the stored image_prompt is the scrubbed final prompt and contains no display name", async () => {
    const seed = await seedEndedMeeting({ withBriefReady: true });
    const { context } = makeTestJobContext({ db: workerDb });
    await renderComicTask({ comicId: seed.comicId, meetingId: seed.meetingId }, context);
    const panels = await readPanels(seed);
    expect(panels).toHaveLength(6);
    panels.forEach((panel, index) => {
      expect(panel.image_prompt).toContain(`Panel ${String(index + 1)} of 6`);
      expect(panel.image_prompt).not.toContain("Test A");
      expect(panel.image_prompt).not.toContain("Test B");
    });
  });
});
