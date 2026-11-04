import { AVATARS, ComicView, EVENT_VERSION, SESSION_COOKIE } from "@meet-first/contracts";
import {
  appendMeetingEvent,
  makeDatabase,
  POOL_SIZE,
  withMeeting,
  type Database,
} from "@meet-first/db";
import {
  createPairedMeetingWithTurns,
  createTestPerson,
  readTestDatabaseUrls,
} from "@meet-first/db/testing";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../testing/index.js";
import { enqueuedJobs } from "../testing/app-factory.js";
import { registerComicsRoutes } from "./index.js";

// The origin every request of this file carries: the test app's own address.
const ORIGIN = "http://localhost:3000";
// A small webp-shaped body for a stored panel; the route serves the bytes as they are stored.
const PANEL_BYTES = Buffer.from("RIFF0000WEBPVP8 test panel bytes");

let t: Awaited<ReturnType<typeof buildTestApp>>;
let workerDb: Kysely<Database>;
beforeAll(async () => {
  t = await buildTestApp({ routes: [registerComicsRoutes], env: { APP_ORIGIN: ORIGIN } });
  workerDb = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, POOL_SIZE.test);
});
afterAll(async () => {
  await workerDb.destroy();
  await t.close();
});

// A person and a session cookie for one test.
type Person = { personId: string; sessionToken: string };

// Sends a POST with a JSON body as the person, with the test app origin.
async function postAs(
  person: Person | undefined,
  url: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown; headers: Record<string, unknown> }> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (person !== undefined) headers.cookie = `${SESSION_COOKIE}=${person.sessionToken}`;
  const response = await t.app.inject({ method: "POST", url, headers, payload });
  return {
    statusCode: response.statusCode,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
    headers: response.headers,
  };
}

// Sends one request as the person, with the test app origin, and reads the JSON reply.
async function send(
  person: Person | undefined,
  url: string,
  method: "GET" | "POST",
): Promise<{ statusCode: number; body: unknown; headers: Record<string, unknown> }> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (person !== undefined) headers.cookie = `${SESSION_COOKIE}=${person.sessionToken}`;
  const response = await t.app.inject({ method, url, headers });
  return {
    statusCode: response.statusCode,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
    headers: response.headers,
  };
}

// The meeting's brief.ready event and both brief rows, written as the worker writes them (briefs spec 4.1).
async function markBriefReady(meetingId: string, personIds: string[]): Promise<void> {
  await withMeeting(workerDb, meetingId, async (trx) => {
    for (const personId of personIds) {
      await trx
        .insertInto("briefs")
        .values({
          meeting_id: meetingId,
          person_id: personId,
          agree: JSON.stringify([]),
          clash: JSON.stringify([]),
          decide_first: JSON.stringify([]),
          model: "muse-spark-1.3",
          prompt_version: "v1",
        })
        .execute();
    }
    await appendMeetingEvent(trx, meetingId, {
      v: EVENT_VERSION,
      type: "brief.ready",
      meetingId,
      at: new Date().toISOString(),
      supportRate: { a: null, b: null },
    });
  });
}

// The comic row of a meeting as the worker reads it.
async function comicRow(
  meetingId: string,
): Promise<{ id: string; avatar_a: string; avatar_b: string; state: string } | undefined> {
  return withMeeting(workerDb, meetingId, (trx) =>
    trx
      .selectFrom("comics")
      .select(["id", "avatar_a", "avatar_b", "state"])
      .where("meeting_id", "=", meetingId)
      .executeTakeFirst(),
  );
}

describe("comic routes", () => {
  it("W2-COMIC-T12 (R11.2): POST before brief.ready is 409 brief_not_ready; after it, 202 with a comicId and one render_comic job", async () => {
    const meeting = await createPairedMeetingWithTurns(t.db);
    const a: Person = { personId: meeting.a.personId, sessionToken: meeting.a.sessionToken };
    const early = await postAs(a, `/api/meetings/${meeting.meetingId}/comic`, {
      avatar: AVATARS[0],
    });
    expect(early.statusCode).toBe(409);
    expect(early.body).toMatchObject({ code: "brief_not_ready" });

    await markBriefReady(meeting.meetingId, [meeting.a.personId, meeting.b.personId]);
    const requested = await postAs(a, `/api/meetings/${meeting.meetingId}/comic`, {
      avatar: AVATARS[0],
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.body).toMatchObject({ comicId: expect.any(String) as string });
    const renders = enqueuedJobs(t.app).filter((job) => job.name === "render_comic");
    expect(renders).toHaveLength(1);
    expect(renders[0]?.payload).toEqual({
      comicId: (requested.body as { comicId: string }).comicId,
      meetingId: meeting.meetingId,
    });
    const attempts = await sql<{
      max_attempts: number;
    }>`SELECT max_attempts FROM graphile_worker.jobs WHERE task_identifier = 'render_comic'`.execute(
      workerDb,
    );
    expect(attempts.rows.map((row) => row.max_attempts)).toEqual([1]);
  });

  it("W2-COMIC-T13 (D64): the requester's side gets the chosen avatar and the other side the next one; a second POST returns the same comicId", async () => {
    const meeting = await createPairedMeetingWithTurns(t.db);
    await markBriefReady(meeting.meetingId, [meeting.a.personId, meeting.b.personId]);
    const b: Person = { personId: meeting.b.personId, sessionToken: meeting.b.sessionToken };
    const first = await postAs(b, `/api/meetings/${meeting.meetingId}/comic`, {
      avatar: AVATARS[2],
    });
    expect(first.statusCode).toBe(202);
    const row = await comicRow(meeting.meetingId);
    expect(row).toMatchObject({ avatar_a: AVATARS[3], avatar_b: AVATARS[2] });
    const second = await postAs(
      { personId: meeting.a.personId, sessionToken: meeting.a.sessionToken },
      `/api/meetings/${meeting.meetingId}/comic`,
      { avatar: AVATARS[0] },
    );
    expect(second.statusCode).toBe(202);
    expect(second.body).toEqual(first.body);
    expect(
      enqueuedJobs(t.app).filter(
        (job) =>
          job.name === "render_comic" &&
          (job.payload as { meetingId: string }).meetingId === meeting.meetingId,
      ),
    ).toHaveLength(1);
  });

  it("W2-COMIC-T14: GET /comic returns 404 before a request, state rendering after, and six imageUrls when ready; a non-member gets 404", async () => {
    const meeting = await createPairedMeetingWithTurns(t.db);
    await markBriefReady(meeting.meetingId, [meeting.a.personId, meeting.b.personId]);
    const a: Person = { personId: meeting.a.personId, sessionToken: meeting.a.sessionToken };
    const before = await send(a, `/api/meetings/${meeting.meetingId}/comic`, "GET");
    expect(before.statusCode).toBe(404);
    expect(before.body).toMatchObject({ code: "comic_not_found" });

    await postAs(a, `/api/meetings/${meeting.meetingId}/comic`, { avatar: AVATARS[0] });
    const rendering = await send(a, `/api/meetings/${meeting.meetingId}/comic`, "GET");
    expect(ComicView.parse(rendering.body).state).toBe("rendering");
    expect(rendering.headers["cache-control"]).toBe("no-store");

    const row = await comicRow(meeting.meetingId);
    await withMeeting(workerDb, meeting.meetingId, async (trx) => {
      for (let position = 1; position <= 6; position += 1) {
        await trx
          .insertInto("comic_panels")
          .values({
            comic_id: row?.id ?? "",
            meeting_id: meeting.meetingId,
            position,
            caption: `Caption ${String(position)}`,
            image_prompt: "A and B sit.",
            image: PANEL_BYTES,
          })
          .execute();
      }
      await trx
        .updateTable("comics")
        .set({ state: "ready", finished_at: new Date() })
        .where("id", "=", row?.id ?? "")
        .execute();
    });
    const ready = ComicView.parse(
      (await send(a, `/api/meetings/${meeting.meetingId}/comic`, "GET")).body,
    );
    expect(ready.state).toBe("ready");
    expect(ready.panels.map((panel) => panel.imageUrl)).toEqual(
      [1, 2, 3, 4, 5, 6].map(
        (position) => `/api/comics/${row?.id ?? ""}/panels/${String(position)}`,
      ),
    );

    const outsider = await createTestPerson(t.db, "Outsider");
    const notMember = await send(
      { personId: outsider.personId, sessionToken: outsider.sessionToken },
      `/api/meetings/${meeting.meetingId}/comic`,
      "GET",
    );
    expect(notMember.statusCode).toBe(404);
  });

  it("W2-COMIC-T15: GET /panels/:position returns image/webp for a member and 404 for a non-member and for position 7", async () => {
    const meeting = await createPairedMeetingWithTurns(t.db);
    await markBriefReady(meeting.meetingId, [meeting.a.personId, meeting.b.personId]);
    const a: Person = { personId: meeting.a.personId, sessionToken: meeting.a.sessionToken };
    const requested = await postAs(a, `/api/meetings/${meeting.meetingId}/comic`, {
      avatar: AVATARS[0],
    });
    const comicId = (requested.body as { comicId: string }).comicId;
    await withMeeting(workerDb, meeting.meetingId, async (trx) => {
      await trx
        .insertInto("comic_panels")
        .values({
          comic_id: comicId,
          meeting_id: meeting.meetingId,
          position: 1,
          caption: "Caption 1",
          image_prompt: "A and B sit.",
          image: PANEL_BYTES,
        })
        .execute();
      await trx
        .updateTable("comics")
        .set({ state: "ready", finished_at: new Date() })
        .where("id", "=", comicId)
        .execute();
    });
    const image = await t.app.inject({
      method: "GET",
      url: `/api/comics/${comicId}/panels/1`,
      headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE}=${a.sessionToken}` },
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/webp");
    expect(image.rawPayload).toEqual(PANEL_BYTES);

    const outsider = await createTestPerson(t.db, "Outsider");
    const notMember = await t.app.inject({
      method: "GET",
      url: `/api/comics/${comicId}/panels/1`,
      headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE}=${outsider.sessionToken}` },
    });
    expect(notMember.statusCode).toBe(404);
    const seventh = await t.app.inject({
      method: "GET",
      url: `/api/comics/${comicId}/panels/7`,
      headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE}=${a.sessionToken}` },
    });
    expect(seventh.statusCode).toBe(404);
  });
});
