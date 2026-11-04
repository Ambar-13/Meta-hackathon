import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDatabase, POOL_SIZE, withMeeting, type Database } from "@meet-first/db";
import { freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { seedBriefMeeting, writeBriefFixtures } from "./golden-path-briefs.js";

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let fixtureRoot: string;
beforeEach(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
  fixtureRoot = await mkdtemp(join(tmpdir(), "golden-briefs-"));
});
afterEach(async () => {
  await workerDb.destroy();
  await fresh.drop();
  await rm(fixtureRoot, { recursive: true, force: true });
});

// The verdict lines of each recorded judge reply among the paths the writer printed, read from the chat reply layout.
async function judgeLines(paths: string[]): Promise<Array<{ supported: boolean }>> {
  const judgePaths = paths.filter((path) => path.includes(`${sep}brief_support_judge${sep}`));
  const recorded = await Promise.all(
    judgePaths.map(
      async (path) =>
        JSON.parse(await readFile(path, "utf8")) as {
          response: { choices: Array<{ message: { content: string } }> };
        },
    ),
  );
  return recorded.flatMap(
    (call) =>
      (
        JSON.parse(call.response.choices[0]?.message.content ?? "{}") as {
          lines: Array<{ supported: boolean }>;
        }
      ).lines,
  );
}

describe("golden path brief writer", () => {
  it("W2-BRIEF-G1 (golden path step 13, note 15): the writer writes four fixtures and exactly one line is unsupported", async () => {
    const seeded = await seedBriefMeeting({ appDb: fresh.db, workerDb, end: true });
    const paths = await writeBriefFixtures({
      workerUrl: fresh.workerUrl,
      meetingId: seeded.meetingId,
      fixtureRoot,
    });
    expect(paths).toHaveLength(4);
    expect(paths.filter((path) => path.includes(`${sep}brief${sep}`))).toHaveLength(2);
    const lines = await judgeLines(paths);
    expect(lines).toHaveLength(18);
    expect(lines.filter((line) => !line.supported)).toHaveLength(1);
    const rows = await withMeeting(workerDb, seeded.meetingId, (trx) =>
      trx
        .selectFrom("briefs")
        .select("person_id")
        .where("meeting_id", "=", seeded.meetingId)
        .execute(),
    );
    expect(rows).toHaveLength(2);
  });

  it("W2-BRIEF-G2 (golden path, note 15a): the writer refuses a meeting that has not ended", async () => {
    const seeded = await seedBriefMeeting({ appDb: fresh.db, workerDb, end: false });
    await expect(
      writeBriefFixtures({ workerUrl: fresh.workerUrl, meetingId: seeded.meetingId, fixtureRoot }),
    ).rejects.toMatchObject({ code: "golden_meeting_not_ended" });
  });
});
