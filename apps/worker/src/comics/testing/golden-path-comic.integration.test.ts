import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AVATARS, type Avatar, type BriefPoint, RecordedCall } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, withMeeting, type Database } from "@meet-first/db";
import {
  createPairedMeetingWithTurns,
  freshTestDatabase,
  type TestDatabase,
} from "@meet-first/db/testing";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendMeetingEvent } from "../../meetings/index.js";
import { writeComicFixtures } from "./golden-path-comic.js";

// The largest stored panel in bytes.
const PANEL_CAP_BYTES = 153_600;
// The number of files one golden comic writes: one panels reply and six images.
const GOLDEN_FILES = 7;

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let folder: string;
beforeEach(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
  folder = await mkdtemp(join(tmpdir(), "comic-golden-"));
});
afterEach(async () => {
  await workerDb.destroy();
  await fresh.drop();
  await rm(folder, { recursive: true, force: true });
});

// One brief point with one verified quote.
function point(text: string, turnId: string): BriefPoint {
  return {
    text,
    supported: true,
    quotes: [{ text: "a quote from the meeting", side: "a", turnId, verified: true }],
  };
}

// Seeds an ended meeting with both briefs, the brief.ready event and a comic row that failed for lack of fixtures.
async function seedGoldenMeeting(): Promise<{ meetingId: string }> {
  const meeting = await createPairedMeetingWithTurns(fresh.db);
  const now = new Date();
  const turnA = meeting.a.turnIds[0] ?? "";
  const turnB = meeting.b.turnIds[0] ?? "";
  // One side's brief: three lines in each group, with the display names in the text.
  const briefOf = (
    turnId: string,
    mine: string,
    other: string,
  ): { agree: BriefPoint[]; clash: BriefPoint[]; decide_first: BriefPoint[] } => ({
    agree: [
      point(`${mine} and ${other} want clear owners.`, turnId),
      point("Weekly check-ins suit both sides.", turnId),
      point(`${other} reads plans first.`, turnId),
    ],
    clash: [
      point(`${mine} wants a written plan.`, turnId),
      point("Deadlines feel firm.", turnId),
      point("Who decides late.", turnId),
    ],
    decide_first: [
      point("Who owns the first deadline.", turnId),
      point("How often to check in.", turnId),
      point("Whether plans stay on paper.", turnId),
    ],
  });
  await withMeeting(workerDb, meeting.meetingId, async (trx) => {
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
    const briefA = briefOf(turnA, "Test A", "Test B");
    const briefB = briefOf(turnB, "Test B", "Test A");
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
    await appendMeetingEvent(trx, {
      meetingId: meeting.meetingId,
      type: "brief.ready",
      fields: { supportRate: { a: null, b: null } },
      at: now,
    });
    const avatarA: Avatar = AVATARS[0];
    const avatarB: Avatar = AVATARS[1];
    await trx
      .insertInto("comics")
      .values({
        meeting_id: meeting.meetingId,
        requested_by: meeting.a.personId,
        state: "failed",
        avatar_a: avatarA,
        avatar_b: avatarB,
        prompt_version: "v1",
        purge_after: new Date(now.getTime() + 30 * 86_400_000),
        finished_at: now,
      })
      .execute();
  });
  return { meetingId: meeting.meetingId };
}

describe("golden path comic fixtures", () => {
  it("writes seven fixtures for a seeded meeting, and each image is a webp under 150 KB", async () => {
    const seeded = await seedGoldenMeeting();
    const paths = await writeComicFixtures({
      workerUrl: fresh.workerUrl,
      meetingId: seeded.meetingId,
      fixtureRoot: folder,
    });
    expect(paths).toHaveLength(GOLDEN_FILES);
    const images = paths.filter((path) => path.includes("comic_image"));
    expect(images).toHaveLength(GOLDEN_FILES - 1);
    for (const path of images) {
      const call = RecordedCall.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
      const data = call.response.data as Array<{ b64_json: string }>;
      const bytes = Buffer.from(data[0]?.b64_json ?? "", "base64");
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(bytes.length).toBeLessThan(PANEL_CAP_BYTES);
    }
  });

  it("refuses a meeting that has no comic row", async () => {
    const meeting = await createPairedMeetingWithTurns(fresh.db);
    await expect(
      writeComicFixtures({
        workerUrl: fresh.workerUrl,
        meetingId: meeting.meetingId,
        fixtureRoot: folder,
      }),
    ).rejects.toMatchObject({ code: "golden_comic_missing" });
  });
});
