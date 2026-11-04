import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Brief, ErrorBody, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, withMeeting, type Database } from "@meet-first/db";
import {
  createPairedMeetingWithTurns,
  createTestPerson,
  readTestDatabaseUrls,
  type SeededMeeting,
} from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { registerBriefsRoutes } from "./index.js";

// The origin every request of this file carries: the test app's own address.
const ORIGIN = "http://localhost:3000";
// The body of a brief that is still being written.
const NOT_READY = {
  code: "brief_not_ready",
  message: "The brief is not written yet. Ask again in a few seconds.",
};
// The body of a brief the caller may not see, or that does not exist.
const NOT_FOUND = {
  code: "brief_not_found",
  message: "This brief does not exist or is not yours.",
};

let t: Awaited<ReturnType<typeof buildTestApp>>;
let workerDb: Kysely<Database>;
beforeAll(async () => {
  t = await buildTestApp({ routes: [registerBriefsRoutes], env: { APP_ORIGIN: ORIGIN } });
  workerDb = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, POOL_SIZE.test);
});
afterAll(async () => {
  await workerDb.destroy();
  await t.close();
});

// One brief line as the briefs table stores it.
function line(spec: { text: string; side: "a" | "b"; turnId: string; supported: boolean | null }) {
  return {
    text: spec.text,
    quotes: [
      {
        text: `A quote that says ${spec.text.toLowerCase()}.`,
        side: spec.side,
        turnId: spec.turnId,
        verified: true,
      },
    ],
    supported: spec.supported,
  };
}

// Writes one brief row for one person of a meeting, through the worker. The first decide-first line gets the given support flag.
async function writeBrief(
  meeting: SeededMeeting,
  owner: { personId: string; side: "a" | "b" },
  decideFirstFirst: boolean | null,
): Promise<void> {
  const { side } = owner;
  const turnId = side === "a" ? (meeting.a.turnIds[0] ?? "") : (meeting.b.turnIds[0] ?? "");
  const agree = [0, 1, 2].map((index) =>
    line({ text: `Side ${side} agrees on point ${String(index)}`, side, turnId, supported: true }),
  );
  const clash = [0, 1, 2].map((index) =>
    line({ text: `Side ${side} clashes on point ${String(index)}`, side, turnId, supported: true }),
  );
  const decideFirst = [
    line({
      text: `Side ${side} decides first on point 0`,
      side,
      turnId,
      supported: decideFirstFirst,
    }),
    line({ text: `Side ${side} decides first on point 1`, side, turnId, supported: true }),
    line({ text: `Side ${side} decides first on point 2`, side, turnId, supported: true }),
  ];
  await withMeeting(workerDb, meeting.meetingId, (trx) =>
    trx
      .insertInto("briefs")
      .values({
        meeting_id: meeting.meetingId,
        person_id: owner.personId,
        agree: JSON.stringify(agree),
        clash: JSON.stringify(clash),
        decide_first: JSON.stringify(decideFirst),
        model: "muse-spark-1.3",
        prompt_version: "v1",
        support_checked_at: new Date(),
        support_rate: 0.889,
        support_reliable: true,
        support_raw: JSON.stringify({}),
      })
      .execute(),
  );
}

// A GET of the brief route as one person (or as nobody), with the test app's origin.
async function getBrief(
  token: string | undefined,
  meetingId: string,
): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (token !== undefined) headers.cookie = `${SESSION_COOKIE}=${token}`;
  const response = await t.app.inject({
    method: "GET",
    url: routes.briefs.readBrief.path.replace(":id", meetingId),
    headers,
  });
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
  };
}

describe("GET /api/meetings/:id/brief", () => {
  it("W2-BRIEF-T14 (A1): GET returns the caller's brief only", async () => {
    const meeting = await createPairedMeetingWithTurns(t.db);
    await writeBrief(meeting, { personId: meeting.a.personId, side: "a" }, true);
    await writeBrief(meeting, { personId: meeting.b.personId, side: "b" }, true);
    const forA = await getBrief(meeting.a.sessionToken, meeting.meetingId);
    const forB = await getBrief(meeting.b.sessionToken, meeting.meetingId);
    expect(forA.statusCode).toBe(200);
    expect(forB.statusCode).toBe(200);
    expect(forA.headers["cache-control"]).toBe("no-store");
    const briefA = Brief.parse(forA.body);
    const briefB = Brief.parse(forB.body);
    expect(briefA.agree[0]?.text).toBe("Side a agrees on point 0");
    expect(briefB.agree[0]?.text).toBe("Side b agrees on point 0");
    expect(JSON.stringify(forA.body)).not.toContain("Side b");
    expect(JSON.stringify(forB.body)).not.toContain("Side a");
  });

  it("W2-BRIEF-T15: GET returns 404 brief_not_ready before the row exists and brief_not_found for a meeting the caller is not in", async () => {
    const meeting = await createPairedMeetingWithTurns(t.db);
    const notReady = await getBrief(meeting.a.sessionToken, meeting.meetingId);
    expect(notReady.statusCode).toBe(404);
    expect(ErrorBody.parse(notReady.body)).toEqual(NOT_READY);
    const stranger = await createTestPerson(t.db, "Stranger");
    const strangerView = await getBrief(stranger.sessionToken, meeting.meetingId);
    const missing = await getBrief(stranger.sessionToken, randomUUID());
    expect(strangerView.statusCode).toBe(404);
    expect(ErrorBody.parse(strangerView.body)).toEqual(NOT_FOUND);
    expect(JSON.stringify(strangerView.body)).toBe(JSON.stringify(missing.body));
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(NOT_FOUND));
  });

  it("W2-BRIEF-T16 (invariant 19 on the wire): a stored supported null reaches the browser as null, not false", async () => {
    const meeting = await createPairedMeetingWithTurns(t.db);
    await writeBrief(meeting, { personId: meeting.a.personId, side: "a" }, null);
    const response = await getBrief(meeting.a.sessionToken, meeting.meetingId);
    const body = response.body as { decideFirst: Array<{ supported: unknown }> };
    expect(body.decideFirst[0]?.supported).toBeNull();
    expect(body.decideFirst[0]?.supported).not.toBe(false);
  });
});
