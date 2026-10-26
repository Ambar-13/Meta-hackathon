import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AVATARS, COMIC_PANELS, ConsentResponse, ConsentWithdrawResponse, ErrorBody, EVENT_VERSION, eventToPayload, routes, ShareSnapshot, type BriefReady } from "@meet-first/contracts";
import { makeDatabase, withMeeting, type Database } from "@meet-first/db";
import { createPairedMeeting, createTestPerson, readTestDatabaseUrls } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { sessionHeader } from "../testing/cookie-jar.js";
import { registerShareRoutes } from "./index.js";

// The takedown script and the local tsx runner, both at the repository root.
const TAKEDOWN_SCRIPT = fileURLToPath(new URL("../../../../scripts/share-takedown.ts", import.meta.url));
const TSX_RUNNER = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));
// The fixed time the seeded brief.ready event carries.
const EVENT_AT = "2026-10-26T12:00:00.000Z";

// The shared app kit and the worker connection that writes the seed rows.
let kit: Awaited<ReturnType<typeof buildTestApp>>;
let workerDb: Kysely<Database>;

// One seeded meeting: its id and the two people who sit in it.
type Seeded = Awaited<ReturnType<typeof createPairedMeeting>>;

beforeAll(async () => {
  kit = await buildTestApp({ routes: [registerShareRoutes] });
  workerDb = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, 2);
});

afterAll(async () => {
  await workerDb.destroy();
  await kit.close();
});

// Creates a paired meeting. When ended is true it runs and ends, and when withBrief is true it also stores brief.ready at seq 1.
async function meetingFor(options: { ended: boolean; withBrief: boolean }): Promise<Seeded> {
  const seeded = await createPairedMeeting(kit.db, { questionId: 3 });
  if (!options.ended) return seeded;
  await withMeeting(workerDb, seeded.meetingId, async (trx) => {
    await trx.updateTable("meetings").set({ state: "running", started_at: new Date(), ends_at: new Date() }).where("id", "=", seeded.meetingId).execute();
    await trx.updateTable("meetings").set({ state: "ended", ended_at: new Date(), end_reason: "decided" }).where("id", "=", seeded.meetingId).execute();
  });
  if (options.withBrief) {
    const briefReady: BriefReady = { v: EVENT_VERSION, meetingId: seeded.meetingId, at: EVENT_AT, seq: 1, type: "brief.ready", supportRate: { a: null, b: null } };
    await withMeeting(workerDb, seeded.meetingId, (trx) =>
      trx.insertInto("meeting_events").values({ meeting_id: seeded.meetingId, seq: 1, type: "brief.ready", v: EVENT_VERSION, payload: JSON.stringify(eventToPayload(briefReady)), created_at: EVENT_AT }).execute(),
    );
  }
  return seeded;
}

// Writes a ready comic with six small panels for the meeting, as the comic job does.
async function addReadyComic(meetingId: string, requestedBy: string): Promise<void> {
  await withMeeting(workerDb, meetingId, async (trx) => {
    const comic = await trx.insertInto("comics").values({ meeting_id: meetingId, requested_by: requestedBy, state: "ready", avatar_a: AVATARS[0], avatar_b: AVATARS[1], prompt_version: "test", purge_after: new Date(Date.now() + 30 * 86_400_000) }).returning("id").executeTakeFirstOrThrow();
    for (let position = 1; position <= COMIC_PANELS; position += 1) {
      await trx.insertInto("comic_panels").values({ comic_id: comic.id, meeting_id: meetingId, position, caption: `Panel ${String(position)} caption`, image_prompt: "test prompt", image: Buffer.from("RIFF test panel") }).execute();
    }
  });
}

// The share page row of a meeting, read through the worker connection.
async function pageRow(meetingId: string) {
  return withMeeting(workerDb, meetingId, (trx) =>
    trx.selectFrom("share_pages").select(["slug", "consent_a", "consent_b", "published", "snapshot", "published_at", "revoked_at"]).where("meeting_id", "=", meetingId).executeTakeFirstOrThrow(),
  );
}

// One consent request by a person, and its reply.
function consent(meetingId: string, sessionToken: string) {
  return kit.app.inject({ method: "POST", url: routes.briefs.consent.path.replace(":id", meetingId), headers: sessionHeader(sessionToken) });
}

// One withdrawal by a person, and its reply.
function withdraw(meetingId: string, sessionToken: string) {
  return kit.app.inject({ method: "DELETE", url: routes.briefs.withdrawConsent.path.replace(":id", meetingId), headers: sessionHeader(sessionToken) });
}

// One public read of a slug, and its reply.
function readPublic(slug: string) {
  return kit.app.inject({ method: "GET", url: routes.briefs.readShare.path.replace(":slug", slug) });
}

// The JSON body of a reply, as unknown until a schema reads it.
function bodyOf(reply: { body: string }): unknown {
  return JSON.parse(reply.body) as unknown;
}

// The error code of a refused reply.
function codeOf(reply: { body: string }): string {
  return ErrorBody.parse(bodyOf(reply)).code;
}

// Both members consent, in order, and the slug the second consent returns.
async function consentBoth(seeded: Seeded): Promise<string> {
  const first = await consent(seeded.meetingId, seeded.a.sessionToken);
  expect(first.statusCode).toBe(200);
  const second = await consent(seeded.meetingId, seeded.b.sessionToken);
  expect(second.statusCode).toBe(200);
  return ConsentResponse.parse(bodyOf(second)).slug ?? "";
}

// Runs the takedown script on the test database with the given arguments, and returns its exit code and output.
function runTakedown(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(TSX_RUNNER, [TAKEDOWN_SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL_WORKER: readTestDatabaseUrls(process.env).workerUrl },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

it("W2-SHARE-T5 (D68, invariant 13): the slug exists only after both consents", async () => {
  const seeded = await meetingFor({ ended: true, withBrief: true });
  const first = await consent(seeded.meetingId, seeded.a.sessionToken);
  expect(first.statusCode).toBe(200);
  const firstBody = ConsentResponse.parse(bodyOf(first));
  expect(firstBody).toEqual({ consentA: true, consentB: false, published: false });
  const slug = (await pageRow(seeded.meetingId)).slug;
  expect((await readPublic(slug)).statusCode).toBe(404);
  const second = await consent(seeded.meetingId, seeded.b.sessionToken);
  const secondBody = ConsentResponse.parse(bodyOf(second));
  expect(secondBody.published).toBe(true);
  expect(secondBody.slug).toHaveLength(22);
  const live = await readPublic(secondBody.slug ?? "");
  expect(live.statusCode).toBe(200);
  expect(ShareSnapshot.safeParse(bodyOf(live)).success).toBe(true);
  expect((await pageRow(seeded.meetingId)).published_at).not.toBeNull();
});

it("W2-SHARE-T6 (D68): withdrawing either consent gives 404 on the next public read, and re-consent rebuilds the snapshot", async () => {
  const seeded = await meetingFor({ ended: true, withBrief: true });
  const slug = await consentBoth(seeded);
  expect((await readPublic(slug)).statusCode).toBe(200);
  const withdrawn = await withdraw(seeded.meetingId, seeded.a.sessionToken);
  expect(ConsentWithdrawResponse.parse(bodyOf(withdrawn))).toEqual({ published: false });
  const gone = await readPublic(slug);
  expect(gone.statusCode).toBe(404);
  expect(codeOf(gone)).toBe("share_not_found");
  expect((await pageRow(seeded.meetingId)).snapshot).toBeNull();
  const again = await consent(seeded.meetingId, seeded.a.sessionToken);
  expect(ConsentResponse.parse(bodyOf(again)).published).toBe(true);
  expect((await readPublic(slug)).statusCode).toBe(200);
});

it("W2-SHARE-T7 (R2.7): revoked_at set by the takedown script hides the page", async () => {
  const byMeeting = await meetingFor({ ended: true, withBrief: true });
  const slugByMeeting = await consentBoth(byMeeting);
  const meetingRun = runTakedown(["--meeting", byMeeting.meetingId]);
  expect(meetingRun.stderr).toBe("");
  expect(meetingRun.status).toBe(0);
  expect(meetingRun.stdout.trim()).toBe("1");
  expect((await readPublic(slugByMeeting)).statusCode).toBe(404);
  const meetingRow = await pageRow(byMeeting.meetingId);
  expect(meetingRow.published).toBe(true);
  expect(meetingRow.revoked_at).not.toBeNull();

  const bySlug = await meetingFor({ ended: true, withBrief: true });
  const slugBySlug = await consentBoth(bySlug);
  const slugRun = runTakedown(["--slug", slugBySlug]);
  expect(slugRun.stderr).toBe("");
  expect(slugRun.status).toBe(0);
  expect(slugRun.stdout.trim()).toBe("revoked");
  expect((await readPublic(slugBySlug)).statusCode).toBe(404);
  expect((await pageRow(bySlug.meetingId)).published).toBe(true);
  const repeat = runTakedown(["--slug", slugBySlug]);
  expect(repeat.stdout.trim()).toBe("not found");
});

it("W2-SHARE-T7b (R2.7): the takedown script refuses bad arguments with exit code 1", () => {
  const none = runTakedown([]);
  expect(none.status).toBe(1);
  expect(none.stderr).toContain("takedown_bad_arguments");
  const both = runTakedown(["--slug", "x", "--meeting", "y"]);
  expect(both.status).toBe(1);
  expect(both.stderr).toContain("takedown_bad_arguments");
});

it("W2-SHARE-T8: consent before brief.ready is 409 brief_not_ready; a non-member is 404; a repeated consent is idempotent", async () => {
  const notEnded = await meetingFor({ ended: false, withBrief: false });
  const refusedWhileRunning = await consent(notEnded.meetingId, notEnded.a.sessionToken);
  expect(refusedWhileRunning.statusCode).toBe(409);
  expect(codeOf(refusedWhileRunning)).toBe("brief_not_ready");

  const noBrief = await meetingFor({ ended: true, withBrief: false });
  const refusedWithoutBrief = await consent(noBrief.meetingId, noBrief.a.sessionToken);
  expect(refusedWithoutBrief.statusCode).toBe(409);
  expect(codeOf(refusedWithoutBrief)).toBe("brief_not_ready");

  const seeded = await meetingFor({ ended: true, withBrief: true });
  const outsider = await createTestPersonFor("Outsider");
  const notMember = await consent(seeded.meetingId, outsider);
  expect(notMember.statusCode).toBe(404);
  expect(codeOf(notMember)).toBe("meeting_not_found");

  const once = await consent(seeded.meetingId, seeded.a.sessionToken);
  const twice = await consent(seeded.meetingId, seeded.a.sessionToken);
  expect(ConsentResponse.parse(bodyOf(once))).toEqual({ consentA: true, consentB: false, published: false });
  expect(ConsentResponse.parse(bodyOf(twice))).toEqual({ consentA: true, consentB: false, published: false });
});

it("W2-SHARE-T9 (D67): the snapshot carries six data:image/webp panels when the comic is ready and no comic field otherwise", async () => {
  const withComic = await meetingFor({ ended: true, withBrief: true });
  await addReadyComic(withComic.meetingId, withComic.a.personId);
  const slugWithComic = await consentBoth(withComic);
  const comicBody = ShareSnapshot.parse(bodyOf(await readPublic(slugWithComic)));
  expect(comicBody.comic).toHaveLength(COMIC_PANELS);
  for (const panel of comicBody.comic ?? []) {
    expect(panel.imageUrl.startsWith("data:image/webp;base64,")).toBe(true);
  }

  const withoutComic = await meetingFor({ ended: true, withBrief: true });
  const slugWithout = await consentBoth(withoutComic);
  const plainBody = bodyOf(await readPublic(slugWithout));
  expect(plainBody).not.toHaveProperty("comic");
});

it("W2-SHARE-T10: two second-consents racing fill the snapshot once", async () => {
  const seeded = await meetingFor({ ended: true, withBrief: true });
  const first = await consent(seeded.meetingId, seeded.a.sessionToken);
  expect(first.statusCode).toBe(200);
  const [left, right] = await Promise.all([consent(seeded.meetingId, seeded.b.sessionToken), consent(seeded.meetingId, seeded.b.sessionToken)]);
  expect(ConsentResponse.parse(bodyOf(left)).published).toBe(true);
  expect(ConsentResponse.parse(bodyOf(right)).published).toBe(true);
  const row = await pageRow(seeded.meetingId);
  expect(row.snapshot).not.toBeNull();
  expect(row.published_at).not.toBeNull();
});

// Creates one person with a session and returns the session token, for a request from outside the meeting.
async function createTestPersonFor(name: string): Promise<string> {
  const person = await createTestPerson(kit.db, name);
  return person.sessionToken;
}
