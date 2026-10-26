import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskCreateResponse, ContractError, ErrorBody, routes, SESSION_COOKIE, type Enqueue } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { createTestPerson } from "@meet-first/db/testing";
import { ENQUEUE_FAILED_SENTENCE } from "../job-queue.js";
import { startOfUtcDay } from "../meetings/create-meeting.js";
import { enqueuedJobs } from "../testing/app-factory.js";
import { buildTestApp } from "../testing/index.js";
import { createAsk } from "./create-ask.js";
import { registerAsksRoutes } from "./index.js";

// The origin every request of this file sends: the test app's own address.
const ORIGIN = "http://localhost:3000";

let t: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  t = await buildTestApp({ routes: [registerAsksRoutes], env: { APP_ORIGIN: ORIGIN } });
});
afterAll(async () => {
  await t.close();
});

// One request: method, URL, the session token of the person making it (none for a request without a session), a JSON payload or a
// raw string payload, and whether to leave out the Origin header.
type Call = { method: "GET" | "POST"; url: string; token?: string; payload?: unknown; withoutOrigin?: boolean };

// The text a payload is sent as: a string as it is, anything else as JSON.
function payloadText(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

// Makes one request through the app's injector and returns the status, the headers and the parsed body.
async function send(call: Call): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (call.withoutOrigin !== true) headers.origin = ORIGIN;
  if (call.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${call.token}`;
  const payload = payloadText(call.payload);
  const response = await t.app.inject({ method: call.method, url: call.url, headers, ...(payload === undefined ? {} : { payload }) });
  return { statusCode: response.statusCode, headers: response.headers, body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown) };
}

// The help text the tests send.
const HELP_TEXT = "Our deploys fail at night and nobody knows why.";
// The reply to every request body that is refused.
const PAYLOAD_INVALID = { code: "payload_invalid", message: "The request body did not match the expected shape. Reload and try again." };

// Writes count help searches of the person at one time, as earlier requests would have.
async function seedHelpRows(input: { personId: string; count: number; createdAt: Date }): Promise<void> {
  await withPerson(t.db, input.personId, (trx) => trx.insertInto("persona_asks").values(Array.from({ length: input.count }, () => ({ person_id: input.personId, mode: "help" as const, text: "Seeded help search", created_at: input.createdAt }))).execute());
}

// The person's help searches: how many in all, and how many since midnight UTC today.
async function countHelpRows(personId: string): Promise<{ total: number; today: number }> {
  const rows = await withPerson(t.db, personId, (trx) => trx.selectFrom("persona_asks").select("created_at").where("person_id", "=", personId).where("mode", "=", "help").execute());
  const midnight = startOfUtcDay(new Date()).getTime();
  return { total: rows.length, today: rows.filter((row) => row.created_at.getTime() >= midnight).length };
}

// The payloads of the run_ask jobs this test app enqueued for one asker.
function runAskJobsOf(personId: string): unknown[] {
  return enqueuedJobs(t.app).filter((job) => job.name === "run_ask" && (job.payload as { personId: string }).personId === personId).map((job) => job.payload);
}

// Sends one help search as a person, with the given text.
async function sendHelp(input: { token: string; text: string }): Promise<{ statusCode: number; body: unknown }> {
  return send({ method: "POST", url: routes.asks.createAsk.path, token: input.token, payload: { mode: "help", text: input.text } });
}

describe("POST /api/asks, help searches", () => {
  it("W6-ASKA-T5 (design section 6): a help search is stored once in state checking with its trimmed text, and run_ask is enqueued with the ask and the asker", async () => {
    const person = await createTestPerson(t.db, "Help Asker");

    const response = await sendHelp({ token: person.sessionToken, text: "  " + HELP_TEXT + "  " });

    expect(response.statusCode).toBe(201);
    const { askId } = AskCreateResponse.parse(response.body);
    const row = await withPerson(t.db, person.personId, (trx) => trx.selectFrom("persona_asks").select(["person_id", "mode", "pair_id", "text", "state", "refused_reason", "about_name", "question_kind", "finished_at"]).where("id", "=", askId).executeTakeFirstOrThrow());
    expect(row).toEqual({ person_id: person.personId, mode: "help", pair_id: null, text: HELP_TEXT, state: "checking", refused_reason: null, about_name: null, question_kind: null, finished_at: null });
    expect(enqueuedJobs(t.app).at(-1)).toEqual({ name: "run_ask", payload: { askId, personId: person.personId } });
    expect(await countHelpRows(person.personId)).toEqual({ total: 1, today: 1 });
  });

  it("W6-ASKA-T6 (design section 5): the sixth help search of a UTC day is 429 help_daily_cap, and searches from before midnight UTC do not count", async () => {
    const person = await createTestPerson(t.db, "Capped Asker");
    await seedHelpRows({ personId: person.personId, count: 5, createdAt: new Date(startOfUtcDay(new Date()).getTime() - 60_000) });
    await seedHelpRows({ personId: person.personId, count: 4, createdAt: new Date() });

    const first = await sendHelp({ token: person.sessionToken, text: HELP_TEXT });
    const second = await sendHelp({ token: person.sessionToken, text: HELP_TEXT });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(ErrorBody.parse(second.body)).toEqual({ code: "help_daily_cap", message: "You have used today's help searches. Try again tomorrow." });
    expect(await countHelpRows(person.personId)).toEqual({ total: 10, today: 5 });
    expect(runAskJobsOf(person.personId)).toHaveLength(1);
  });

  it("W6-ASKA-T7 (design section 5): six help searches sent at the same moment give five 201 replies and one 429, and five rows", async () => {
    const person = await createTestPerson(t.db, "Racing Asker");

    const replies = await Promise.all(Array.from({ length: 6 }, () => sendHelp({ token: person.sessionToken, text: HELP_TEXT })));

    expect(replies.map((reply) => reply.statusCode).sort((a, b) => a - b)).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await countHelpRows(person.personId)).total).toBe(5);
    expect(runAskJobsOf(person.personId)).toHaveLength(5);
  });

  it("W6-ASKA-T8 (design section 6): a body that is not AskCreate, or a text under 5 characters, is 400 payload_invalid and writes nothing", async () => {
    const person = await createTestPerson(t.db, "Bad Body");
    const payloads: unknown[] = [{ mode: "help", text: "abcd" }, { mode: "help", text: "a😀😀" }, { mode: "help", text: "x".repeat(301) }, { mode: "chat", text: HELP_TEXT }, { mode: "react", text: HELP_TEXT }, "not json"];

    for (const payload of payloads) {
      const response = await send({ method: "POST", url: routes.asks.createAsk.path, token: person.sessionToken, payload });
      expect(response.statusCode).toBe(400);
      expect(ErrorBody.parse(response.body)).toEqual(PAYLOAD_INVALID);
    }
    expect((await countHelpRows(person.personId)).total).toBe(0);
    expect(runAskJobsOf(person.personId)).toHaveLength(0);
  });

  it("W6-ASKA-T9 (job-queue.ts rule): when a fake enqueue refuses run_ask, createAsk deletes the ask it wrote and throws enqueue_failed", async () => {
    const person = await createTestPerson(t.db, "Queue Refused");
    const failingEnqueue: Enqueue = () => Promise.reject(new ContractError("enqueue_failed", ENQUEUE_FAILED_SENTENCE));

    const attempt = createAsk({ db: t.db, now: () => new Date(), enqueue: failingEnqueue }, person.personId, { mode: "help", text: HELP_TEXT });

    await expect(attempt).rejects.toMatchObject({ code: "enqueue_failed", message: "The job queue did not accept the job. Retry the request." });
    expect((await countHelpRows(person.personId)).total).toBe(0);
  });
});
