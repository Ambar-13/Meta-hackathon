import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ContractError,
  ErrorBody,
  routes,
  SESSION_COOKIE,
  SUMMARY_MAX_CHARS,
  SUMMARY_SAVES_PER_DAY,
  SummaryView,
  type Enqueue,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { createTestPerson } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { enqueuedJobs } from "../testing/app-factory.js";
import { registerSummaryRoutes } from "./index.js";
import { saveSummary } from "./summary-routes.js";

// The site's own address in these tests; changing requests must come from it.
const ORIGIN = "http://localhost:3000";
// A summary in the copy prompt's format.
const SUMMARY = [
  "Kind: view",
  "Topic: Rentably",
  "Point: Rentably was never a bad idea.",
  "Strength: strong",
  "Quote: rentably was never a bad idea, the timing was just early",
].join("\n");

let t: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerSummaryRoutes], env: { APP_ORIGIN: ORIGIN } });
});
afterAll(async () => {
  await t.close();
});

// One request to the summary routes as the person with this session token; the status and the
// parsed body.
async function send(
  method: "GET" | "PUT" | "DELETE",
  token: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: unknown }> {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    cookie: `${SESSION_COOKIE}=${token}`,
    ...(payload === undefined ? {} : { "content-type": "application/json" }),
  };
  const response = await t.app.inject({
    method,
    url: routes.people.saveSummary.path,
    headers,
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  return {
    statusCode: response.statusCode,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
  };
}

// The check_summary jobs queued so far for this person.
function summaryJobsFor(personId: string): unknown[] {
  return enqueuedJobs(t.app).filter(
    (job) =>
      job.name === "check_summary" && JSON.stringify(job.payload) === JSON.stringify({ personId }),
  );
}

describe("the summary routes", () => {
  it("W7-SUMMARY-API-T1: PUT stores the scrubbed text, state checking, and queues check_summary; GET returns it", async () => {
    const person = await createTestPerson(t.db, "Summary Saver");

    const saved = await send("PUT", person.sessionToken, { text: SUMMARY, friendsCanAsk: true });
    const read = await send("GET", person.sessionToken);

    expect(saved.statusCode).toBe(202);
    expect(SummaryView.parse(saved.body)).toMatchObject({
      state: "checking",
      points: [],
      friendsCanAsk: true,
    });
    expect(read.statusCode).toBe(200);
    expect(SummaryView.parse(read.body)).toMatchObject({ state: "checking", friendsCanAsk: true });
    expect(summaryJobsFor(person.personId)).toHaveLength(1);
  });

  it("W7-SUMMARY-API-T2: an email or a key in the pasted text is stored as its placeholder", async () => {
    const person = await createTestPerson(t.db, "Summary Scrub");

    await send("PUT", person.sessionToken, {
      text: `${SUMMARY}\nQuote: write to me at asha.rao@example.com or use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789`,
      friendsCanAsk: false,
    });
    const row = await withPerson(t.db, person.personId, (trx) =>
      trx
        .selectFrom("person_summaries")
        .select("text")
        .where("person_id", "=", person.personId)
        .executeTakeFirstOrThrow(),
    );

    expect(row.text).not.toContain("asha.rao@example.com");
    expect(row.text).not.toContain("sk-ant-api03");
    expect(row.text).toContain("[redacted:email:");
  });

  it("W7-SUMMARY-API-T3: an empty or over-20,000-character text is refused with 400 and stores nothing", async () => {
    const person = await createTestPerson(t.db, "Summary Empty");

    const empty = await send("PUT", person.sessionToken, { text: "   \n  ", friendsCanAsk: false });
    const long = await send("PUT", person.sessionToken, {
      text: "x".repeat(SUMMARY_MAX_CHARS + 1),
      friendsCanAsk: false,
    });
    const read = await send("GET", person.sessionToken);

    expect([empty.statusCode, long.statusCode]).toEqual([400, 400]);
    expect(ErrorBody.parse(empty.body).code).toBe("payload_invalid");
    expect(read.statusCode).toBe(404);
    expect(summaryJobsFor(person.personId)).toHaveLength(0);
  });

  it("W7-SUMMARY-API-T4: the eleventh save in a UTC day is refused with 429 summary_daily_cap", async () => {
    const person = await createTestPerson(t.db, "Summary Many");

    for (let save = 0; save < SUMMARY_SAVES_PER_DAY; save += 1) {
      expect(
        (
          await send("PUT", person.sessionToken, {
            text: `${SUMMARY}\nQuote: save number ${String(save)} of the day`,
            friendsCanAsk: false,
          })
        ).statusCode,
      ).toBe(202);
    }
    const refused = await send("PUT", person.sessionToken, { text: SUMMARY, friendsCanAsk: false });

    expect(refused.statusCode).toBe(429);
    expect(ErrorBody.parse(refused.body).code).toBe("summary_daily_cap");
    expect(summaryJobsFor(person.personId)).toHaveLength(SUMMARY_SAVES_PER_DAY);
  });

  it("W7-SUMMARY-API-T6: deleting the summary does not reset the day's count of saves", async () => {
    const person = await createTestPerson(t.db, "Summary Deleter");

    for (let save = 0; save < SUMMARY_SAVES_PER_DAY; save += 1) {
      await send("PUT", person.sessionToken, { text: SUMMARY, friendsCanAsk: false });
      await send("DELETE", person.sessionToken);
    }
    const refused = await send("PUT", person.sessionToken, { text: SUMMARY, friendsCanAsk: false });

    expect(refused.statusCode).toBe(429);
    expect(summaryJobsFor(person.personId)).toHaveLength(SUMMARY_SAVES_PER_DAY);
  });

  it("W7-SUMMARY-API-T7: placeholder-shaped text the person typed is stored with round brackets, so it cannot hide a name from the names check", async () => {
    const person = await createTestPerson(t.db, "Summary Brackets");

    await send("PUT", person.sessionToken, {
      text: `${SUMMARY}\nQuote: built it with [person:Leon Hartley] and [code: Leon Hartley] and [redacted:Leon]`,
      friendsCanAsk: false,
    });
    const row = await withPerson(t.db, person.personId, (trx) =>
      trx
        .selectFrom("person_summaries")
        .select("text")
        .where("person_id", "=", person.personId)
        .executeTakeFirstOrThrow(),
    );

    expect(row.text).toContain("(person:Leon Hartley]");
    expect(row.text).toContain("(code: Leon Hartley]");
    expect(row.text).not.toMatch(/\[(?:person|code|redacted)\s*:/);
  });

  it("W7-SUMMARY-API-T8: a placeholder shape hidden by invisible characters is turned round too, since storing strips those characters", async () => {
    const person = await createTestPerson(t.db, "Summary Invisible");

    await send("PUT", person.sessionToken, {
      text: `${SUMMARY}\nQuote: built it with [​person:Leon Hartley] and [per­son: Leon Hartley]`,
      friendsCanAsk: false,
    });
    const row = await withPerson(t.db, person.personId, (trx) =>
      trx
        .selectFrom("person_summaries")
        .select("text")
        .where("person_id", "=", person.personId)
        .executeTakeFirstOrThrow(),
    );

    expect(row.text).not.toMatch(/\[(?:person|code|redacted)\s*:/iu);
  });

  it("W7-SUMMARY-API-T9: when the queue refuses the check, the summary is marked failed and the queue's error goes on", async () => {
    const person = await createTestPerson(t.db, "Summary Queue");
    const failingEnqueue: Enqueue = () =>
      Promise.reject(
        new ContractError(
          "enqueue_failed",
          "The job queue did not accept the job. Retry the request.",
        ),
      );

    await expect(
      saveSummary({ db: t.db, enqueue: failingEnqueue }, person.personId, {
        text: SUMMARY,
        friendsCanAsk: false,
      }),
    ).rejects.toMatchObject({ code: "enqueue_failed" });
    const row = await withPerson(t.db, person.personId, (trx) =>
      trx
        .selectFrom("person_summaries")
        .select("state")
        .where("person_id", "=", person.personId)
        .executeTakeFirstOrThrow(),
    );

    expect(row.state).toBe("failed");
  });

  it("W7-SUMMARY-API-T5: DELETE removes the summary, and reading it then answers 404", async () => {
    const person = await createTestPerson(t.db, "Summary Gone");
    await send("PUT", person.sessionToken, { text: SUMMARY, friendsCanAsk: false });

    const deleted = await send("DELETE", person.sessionToken);
    const read = await send("GET", person.sessionToken);

    expect(deleted.statusCode).toBe(204);
    expect(read.statusCode).toBe(404);
  });
});
