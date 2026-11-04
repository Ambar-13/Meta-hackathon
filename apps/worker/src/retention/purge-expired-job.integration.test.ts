import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOB_MAX_ATTEMPTS } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, withMeeting, withPerson, type Database } from "@meet-first/db";
import {
  createTestPerson,
  freshTestDatabase,
  readTestDatabaseUrls,
  sha256Text,
  type TestDatabase,
} from "@meet-first/db/testing";
import { makeTestJobContext } from "../testing/index.js";
import { purgeExpiredTask } from "./purge-expired-job.js";

// The superuser connection to the test database. It sees every row, so the checks are not limited
// by row security.
function superUser(): Kysely<Database> {
  const urls = readTestDatabaseUrls(process.env);
  const url = new URL(urls.adminUrl);
  url.pathname = new URL(urls.migrateUrl).pathname;
  return makeDatabase(url.toString(), 1);
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;

let database: TestDatabase;
let workerDb: Kysely<Database>;
let owner: Kysely<Database>;

// The ids of the rows the purge test seeds, so each check reads its own row back.
type PurgeSeed = {
  personId: string;
  liveLinkId: string;
  expiredLinkId: string;
  unjoinedPairId: string;
  joinedPairId: string;
  oldComicId: string;
  sharedComicId: string;
  futureComicId: string;
};

// Writes two transfer links for the person: one expired eleven minutes ago, one live for five more
// minutes.
async function seedLinks(
  db: Kysely<Database>,
  personId: string,
): Promise<{ liveLinkId: string; expiredLinkId: string }> {
  const rows = await withPerson(db, personId, (trx) =>
    trx
      .insertInto("transfer_links")
      .values([
        {
          person_id: personId,
          token_hash: sha256Text(randomUUID()),
          expires_at: new Date(Date.now() - 11 * MINUTE_MS),
        },
        {
          person_id: personId,
          token_hash: sha256Text(randomUUID()),
          expires_at: new Date(Date.now() + 5 * MINUTE_MS),
        },
      ])
      .returning("id")
      .execute(),
  );
  return { expiredLinkId: rows[0]?.id ?? "", liveLinkId: rows[1]?.id ?? "" };
}

// Writes two pairs the person created, both 25 hours old and past their 24-hour window: one nobody
// joined, one joined.
async function seedPairs(
  db: Kysely<Database>,
  personId: string,
  partnerId: string,
): Promise<{ unjoinedPairId: string; joinedPairId: string }> {
  const created = new Date(Date.now() - 25 * HOUR_MS);
  const rows = await withPerson(db, personId, (trx) =>
    trx
      .insertInto("pairs")
      .values([
        {
          creator_person_id: personId,
          token_hash: sha256Text(randomUUID()),
          expires_at: new Date(Date.now() - HOUR_MS),
          created_at: created,
        },
        {
          creator_person_id: personId,
          joiner_person_id: partnerId,
          token_hash: sha256Text(randomUUID()),
          expires_at: new Date(Date.now() - HOUR_MS),
          joined_at: created,
          created_at: created,
        },
      ])
      .returning("id")
      .execute(),
  );
  return { unjoinedPairId: rows[0]?.id ?? "", joinedPairId: rows[1]?.id ?? "" };
}

// Writes one comic with six panels on a meeting of the joined pair, with its purge date and an
// optional published share page.
async function seedComic(
  db: Kysely<Database>,
  args: { personId: string; pairId: string; purgeAfter: Date; published: boolean },
): Promise<string> {
  const meetingId = randomUUID();
  await withMeeting(db, meetingId, (trx) =>
    trx
      .insertInto("meetings")
      .values({ id: meetingId, pair_id: args.pairId, question_text: "Test question" })
      .execute(),
  );
  const comic = await withMeeting(db, meetingId, (trx) =>
    trx
      .insertInto("comics")
      .values({
        meeting_id: meetingId,
        requested_by: args.personId,
        state: "ready",
        avatar_a: "avatar-a",
        avatar_b: "avatar-b",
        prompt_version: "test",
        purge_after: args.purgeAfter,
        finished_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  await withMeeting(db, meetingId, (trx) =>
    trx
      .insertInto("comic_panels")
      .values(
        Array.from({ length: 6 }, (item, index) => ({
          comic_id: comic.id,
          meeting_id: meetingId,
          position: index + 1,
          caption: "Panel",
          image_prompt: "Test panel",
          image: Buffer.from([1, 2, 3]),
        })),
      )
      .execute(),
  );
  if (args.published) {
    await withMeeting(db, meetingId, (trx) =>
      trx
        .insertInto("share_pages")
        .values({
          meeting_id: meetingId,
          slug: `test-${randomUUID()}`,
          consent_a: true,
          consent_b: true,
          published: true,
          published_at: new Date(),
        })
        .execute(),
    );
  }
  return comic.id;
}

// Writes the rows the purge test needs: transfer links, old pairs, and three comics (one unshared
// and past its date, one shared and past its date, one not yet due).
async function seedPurgeRows(db: Kysely<Database>): Promise<PurgeSeed> {
  const person = await createTestPerson(db, "Test Purge");
  const partner = await createTestPerson(db, "Test Partner");
  const links = await seedLinks(db, person.personId);
  const pairs = await seedPairs(db, person.personId, partner.personId);
  const oldComicId = await seedComic(db, {
    personId: person.personId,
    pairId: pairs.joinedPairId,
    purgeAfter: new Date(Date.now() - DAY_MS),
    published: false,
  });
  const sharedComicId = await seedComic(db, {
    personId: person.personId,
    pairId: pairs.joinedPairId,
    purgeAfter: new Date(Date.now() - DAY_MS),
    published: true,
  });
  const futureComicId = await seedComic(db, {
    personId: person.personId,
    pairId: pairs.joinedPairId,
    purgeAfter: new Date(Date.now() + DAY_MS),
    published: false,
  });
  return {
    personId: person.personId,
    ...links,
    ...pairs,
    oldComicId,
    sharedComicId,
    futureComicId,
  };
}

beforeAll(async () => {
  database = await freshTestDatabase();
  workerDb = makeDatabase(database.workerUrl, POOL_SIZE.test);
  owner = superUser();
});

afterAll(async () => {
  await owner.destroy();
  await workerDb.destroy();
  await database.drop();
});

describe("purge expired job", () => {
  it("W2-DEL-T10 (D33, D32, D64): purge_expired removes expired transfer links, unjoined pairs past 24 h and unshared comics past 30 days, and nothing else (real database clock, no fake clock: the purge reads now() in the database)", async () => {
    const seed = await seedPurgeRows(database.db);
    const lines: string[] = [];
    const log = pino(
      { level: "info" },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );
    const { context } = makeTestJobContext({ db: workerDb });

    await purgeExpiredTask({}, { ...context, log });

    const links = await sql<{
      id: string;
    }>`SELECT id FROM transfer_links WHERE person_id = ${seed.personId}::uuid`.execute(owner);
    expect(links.rows.map((row) => row.id)).toEqual([seed.liveLinkId]);
    const pairs = await sql<{
      id: string;
    }>`SELECT id FROM pairs WHERE id = ANY(${[seed.unjoinedPairId, seed.joinedPairId]}::uuid[])`.execute(
      owner,
    );
    expect(pairs.rows.map((row) => row.id)).toEqual([seed.joinedPairId]);
    const comics = await sql<{
      id: string;
    }>`SELECT id FROM comics WHERE id = ANY(${[seed.oldComicId, seed.sharedComicId, seed.futureComicId]}::uuid[]) ORDER BY id`.execute(
      owner,
    );
    expect(comics.rows.map((row) => row.id).sort()).toEqual(
      [seed.sharedComicId, seed.futureComicId].sort(),
    );
    const panels = await sql<{
      n: string;
    }>`SELECT count(*) AS n FROM comic_panels WHERE comic_id = ${seed.oldComicId}::uuid`.execute(
      owner,
    );
    expect(panels.rows[0]?.n).toBe("0");
    const summary = lines
      .map(
        (line) =>
          JSON.parse(line) as {
            msg?: string;
            transfer_links?: number;
            pairs?: number;
            comics?: number;
          },
      )
      .find((entry) => entry.msg === "purge_expired_done");
    expect(summary).toMatchObject({ transfer_links: 1, pairs: 1, comics: 1 });
  });

  it("W2-DEL-T11: when the purge functions are absent the job throws purge_functions_missing and does not loop", async () => {
    await sql`DROP FUNCTION purge_expired_rows()`.execute(owner);
    const { context } = makeTestJobContext({ db: workerDb });

    await expect(purgeExpiredTask({}, context)).rejects.toMatchObject({
      code: "purge_functions_missing",
    });
    expect(JOB_MAX_ATTEMPTS.purge_expired).toBe(1);
  });
});
