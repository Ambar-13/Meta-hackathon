import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { makeDatabase, POOL_SIZE, withPerson, type Database } from "@meet-first/db";
import { freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { fakeClock } from "../testing/index.js";
import { runAsk } from "./run-ask-job.js";
import {
  ALLOWED_HELP, ASK_LINES, ASK_TURNS, KAI_ALTERED, KAI_HELP, KAI_NOTEBOOK_CLAIM, KAI_VALIDATION_CLAIM, LENA_HELP, NOOR_HELP, REFUSED, ROMANTIC_HELP, ROSA_HELP,
  allSupported, countCalls, createAskPerson, insertHelpAsk, leaveDirectory, listInDirectory, makeAskTestContext, markPublic, readAnswerRows, readAskRow,
  setRomanceSwitch, userTexts, type AskPerson, type AskReplyScript, type AskTestContext,
} from "./testing/index.js";

// The help search the base tests send: its words match Kai's and Lena's public items and lines, and Ana's, whom the shortlist leaves out.
const ML_ASK = "My model training stalls and validation looks wrong, who knows gradient norms?";
// The fake clock's start, so the runAt of a re-queued job is exact.
const CLOCK_START = new Date("2026-10-27T09:00:00.000Z");
// The runAt of a job re-queued at CLOCK_START: 5,000 ms later (LIMITER_RETRY_MS, D58).
const RETRY_AT = new Date("2026-10-27T09:00:05.000Z");

// The answer rows of one ask, as readAnswerRows returns them.
type AnswerRows = Awaited<ReturnType<typeof readAnswerRows>>;

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let ana: AskPerson;
let kai: AskPerson;
let lena: AskPerson;
const listings = new Map<string, string>();
const contexts: AskTestContext[] = [];

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
  ana = await createAskPerson(fresh.db, { name: "Ana", turns: ASK_TURNS.ana });
  kai = await createAskPerson(fresh.db, { name: "Kai", turns: ASK_TURNS.kai });
  lena = await createAskPerson(fresh.db, { name: "Lena", turns: ASK_TURNS.lena });
  const omar = await createAskPerson(fresh.db, { name: "Omar", turns: ASK_TURNS.omar });
  await markPublic(fresh.db, ana, [1]);
  await markPublic(fresh.db, kai, [1, 2]);
  await markPublic(fresh.db, lena, [2]);
  await markPublic(fresh.db, omar, [1]);
  listings.set("Ana", await listInDirectory(fresh.db, ana, { line: ASK_LINES.ana }));
  listings.set("Kai", await listInDirectory(fresh.db, kai, { line: ASK_LINES.kai }));
  listings.set("Lena", await listInDirectory(fresh.db, lena, { line: ASK_LINES.lena }));
  listings.set("Omar", await listInDirectory(fresh.db, omar, { line: ASK_LINES.omar }));
});

afterEach(async () => {
  for (const test of contexts.splice(0)) await test.close();
});

afterAll(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// Opens an ask test context over the worker database with this script, closed after the test.
async function openTest(script: AskReplyScript, now?: () => Date): Promise<AskTestContext> {
  const test = await makeAskTestContext({ db: workerDb, script, ...(now === undefined ? {} : { now }) });
  contexts.push(test);
  return test;
}

// The answer row of one subject; a missing row fails the test with the subject's name.
function rowOf(rows: AnswerRows, person: AskPerson): AnswerRows[number] {
  const row = rows.find((candidate) => candidate.subject_person_id === person.personId);
  if (row === undefined) throw new Error("no answer row for " + person.displayName);
  return row;
}

// How many items one support-check request shows.
function itemCount(user: string | undefined): number {
  return (user ?? "").split('<item index="').length - 1;
}

// The supported value of each stored claim of one row, in claim order.
function supportedOf(claims: unknown[]): unknown[] {
  return claims.map((claim) => (claim as { supported: unknown }).supported);
}

it("W6-ASKW-T16 (design section 4, P1, P4): a help search asks Kai and Lena, never the asker, checks every quote, judges 3 claims and places Kai first", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, ML_ASK);
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Kai: KAI_HELP, Lena: LENA_HELP }, judge: [allSupported(3)] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const ask = await readAskRow(fresh.db, ana, askId);
  expect(ask).toMatchObject({ state: "done", question_kind: "help", refused_reason: null });
  expect(ask.finished_at).not.toBeNull();
  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rows.map((row) => row.subject_display_name).sort()).toEqual(["Kai", "Lena"]);
  expect(rows.map((row) => row.shortlist_rank).sort()).toEqual([1, 2]);
  expect(rowOf(rows, kai)).toMatchObject({
    mode: "help", state: "answered", listing_id: listings.get("Kai"), subject_line: ASK_LINES.kai, subject_card_id: kai.cardId, asker_display_name: "Ana",
    ask_text: ML_ASK, answer: KAI_HELP.answer, has_sign: true, supported_count: 2, position: 1,
  });
  expect(rowOf(rows, kai).claims).toEqual([
    { text: KAI_VALIDATION_CLAIM.text, quote: KAI_VALIDATION_CLAIM.quote, turnId: kai.turnIds[0], verified: true, supported: true },
    { text: KAI_NOTEBOOK_CLAIM.text, quote: KAI_NOTEBOOK_CLAIM.quote, turnId: kai.turnIds[1], verified: true, supported: true },
  ]);
  expect(rowOf(rows, lena)).toMatchObject({ state: "answered", listing_id: listings.get("Lena"), subject_line: ASK_LINES.lena, supported_count: 1, position: 2 });
  expect(rowOf(rows, lena).claims).toEqual([
    { text: "Lena plots gradient norms when training stalls.", quote: "Plotting gradient norms per layer is the first thing I do", turnId: lena.turnIds[1], verified: true, supported: true },
  ]);
  expect([countCalls(test, "question_check"), countCalls(test, "persona_answer"), countCalls(test, "ask_support_judge")]).toEqual([1, 2, 1]);
  expect(itemCount(userTexts(test, "ask_support_judge")[0])).toBe(3);
  const ledger = await withPerson(fresh.db, ana.personId, (trx) => trx.selectFrom("ledger").select(["call_site", "meeting_id", "status"]).execute());
  expect(ledger.map((row) => row.call_site).sort()).toEqual(["ask_support_judge", "persona_answer", "persona_answer", "question_check"]);
  expect(ledger.every((row) => row.meeting_id === null && row.status === "ok")).toBe(true);
});

it("W6-ASKW-T17 (design section 3): a refused ask stores the check's reason, writes no answer row and calls no persona", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, "Rate my model skills from 1 to 10 and promise someone will help");
  const test = await openTest({ questionCheck: [REFUSED], personaAnswers: {}, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const ask = await readAskRow(fresh.db, ana, askId);
  expect(ask).toMatchObject({ state: "refused", refused_reason: REFUSED.reason, question_kind: null });
  expect(ask.finished_at).not.toBeNull();
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual([]);
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});

it("W6-ASKW-T18 (design section 3): a question check that gets no reply fails the ask, and no persona sees it", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, "Who could look at my gradient norms tonight?");
  const test = await openTest({ questionCheck: [], personaAnswers: {}, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const ask = await readAskRow(fresh.db, ana, askId);
  expect(ask).toMatchObject({ state: "failed", refused_reason: null, question_kind: null });
  expect(ask.finished_at).not.toBeNull();
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual([]);
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});

it("W6-ASKW-T19 (D58): with a fake full window at the question check the job re-queues itself 5 s later, and the next run checks the ask", async () => {
  const clock = fakeClock(CLOCK_START);
  const askId = await insertHelpAsk(fresh.db, ana, "Who has debugged validation splits before?");
  const payload = { askId, personId: ana.personId };
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: {}, judge: [], limiterBusy: { callSite: "question_check", times: 1 } }, clock.now);

  await runAsk(payload, test.context);

  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("checking");
  expect(test.enqueued).toEqual([{ name: "run_ask", payload, options: { runAt: RETRY_AT } }]);
  expect(test.calls).toEqual([]);
  await runAsk(payload, test.context);
  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({ state: "done", question_kind: "help" });
  expect(countCalls(test, "question_check")).toBe(1);
});

it("W6-ASKW-T20 (design section 4 step 3): an ask with no word to match is done with no answers and no persona call", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, "?! ?! ?!");
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: {}, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({ state: "done", question_kind: "help" });
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual([]);
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});

it("W6-ASKW-T21 (design section 4 step 3): an ask whose words match no listing is done with no answers", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, "qqqq xxxx zzzz");
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: {}, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({ state: "done", question_kind: "help" });
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual([]);
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});
it("W6-ASKW-T22 (D26, design section 4 step 6): a quote not found in its turn is never judged, and equal supported counts are placed by shortlist rank", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, ML_ASK + " Please help.");
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Kai: KAI_ALTERED, Lena: LENA_HELP }, judge: [allSupported(2)] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rowOf(rows, kai).claims[1]).toEqual({ text: KAI_NOTEBOOK_CLAIM.text, quote: "a lab notebook with the learning rate and the batch size", turnId: null, verified: false, supported: null });
  expect([rowOf(rows, kai).supported_count, rowOf(rows, lena).supported_count]).toEqual([1, 1]);
  expect(rows.map((row) => [row.shortlist_rank, row.position])).toEqual([[1, 1], [2, 2]]);
  expect(itemCount(userTexts(test, "ask_support_judge")[0])).toBe(2);
});

it("W6-ASKW-T23 (design section 4 step 4): a persona call that fails marks only that answer failed, and the others go on", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, ML_ASK + " Thanks.");
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Kai: KAI_HELP }, judge: [allSupported(2)] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rowOf(rows, lena)).toMatchObject({ state: "failed", answer: null, has_sign: null, claims: [], supported_count: null, position: null });
  expect(rowOf(rows, kai)).toMatchObject({ state: "answered", supported_count: 2, position: 1 });
  expect(itemCount(userTexts(test, "ask_support_judge")[0])).toBe(2);
  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("done");
});

it("W6-ASKW-T24 (A1, design section 4 step 5): a support check that gets no reply leaves every claim unchecked, counts the verified claims and still places", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, ML_ASK + " Anyone?");
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Kai: KAI_HELP, Lena: LENA_HELP }, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(supportedOf(rowOf(rows, kai).claims)).toEqual([null, null]);
  expect(supportedOf(rowOf(rows, lena).claims)).toEqual([null]);
  expect(rowOf(rows, kai)).toMatchObject({ supported_count: 2, position: 1 });
  expect(rowOf(rows, lena)).toMatchObject({ supported_count: 1, position: 2 });
  expect(countCalls(test, "ask_support_judge")).toBe(1);
  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("done");
});

it("W6-ASKW-T25 (D58): with a fake full window at the support check the job re-queues itself, and the next run judges without asking the personas again", async () => {
  const clock = fakeClock(CLOCK_START);
  const askId = await insertHelpAsk(fresh.db, ana, ML_ASK + " Judge later.");
  const payload = { askId, personId: ana.personId };
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Kai: KAI_HELP, Lena: LENA_HELP }, judge: [allSupported(3)], limiterBusy: { callSite: "ask_support_judge", times: 1 } }, clock.now);

  await runAsk(payload, test.context);

  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("ranking");
  expect(test.enqueued).toEqual([{ name: "run_ask", payload, options: { runAt: RETRY_AT } }]);
  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => row.supported_count)).toEqual([null, null]);
  await runAsk(payload, test.context);
  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect([rowOf(rows, kai).position, rowOf(rows, lena).position]).toEqual([1, 2]);
  expect([countCalls(test, "persona_answer"), countCalls(test, "ask_support_judge")]).toEqual([2, 1]);
  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("done");
});

it("W6-ASKW-T26 (design section 4 step 1): a second run of a finished ask, and a run for an ask that does not exist, make no call and change nothing", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, ML_ASK + " Twice.");
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Kai: KAI_HELP, Lena: LENA_HELP }, judge: [allSupported(3)] });
  await runAsk({ askId, personId: ana.personId }, test.context);
  const askBefore = await readAskRow(fresh.db, ana, askId);
  const rowsBefore = await readAnswerRows(fresh.db, ana, askId);

  await runAsk({ askId, personId: ana.personId }, test.context);
  await runAsk({ askId: "00000000-0000-4000-8000-000000000999", personId: ana.personId }, test.context);

  expect(test.calls).toHaveLength(4);
  expect(await readAskRow(fresh.db, ana, askId)).toEqual(askBefore);
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual(rowsBefore);
});

it("W6-ASKW-T27 (D58, design section 4 step 4): after a fake full window at the persona calls, the next run fails the answer whose listing is gone and answers the other", async () => {
  const noor = await createAskPerson(fresh.db, { name: "Noor", turns: ASK_TURNS.noor });
  const ivo = await createAskPerson(fresh.db, { name: "Ivo", turns: ASK_TURNS.ivo });
  await markPublic(fresh.db, noor, [1]);
  await markPublic(fresh.db, ivo, [1]);
  await listInDirectory(fresh.db, noor, { line: ASK_LINES.noor });
  await listInDirectory(fresh.db, ivo, { line: ASK_LINES.ivo });
  const clock = fakeClock(CLOCK_START);
  const askId = await insertHelpAsk(fresh.db, ana, "Who has tuned warmup schedules?");
  const payload = { askId, personId: ana.personId };
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Noor: NOOR_HELP }, judge: [allSupported(1)], limiterBusy: { callSite: "persona_answer", times: 2 } }, clock.now);

  await runAsk(payload, test.context);

  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => row.state)).toEqual(["pending", "pending"]);
  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("asking");
  expect(test.enqueued).toEqual([{ name: "run_ask", payload, options: { runAt: RETRY_AT } }]);
  await leaveDirectory(fresh.db, ivo);
  await runAsk(payload, test.context);
  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rowOf(rows, ivo)).toMatchObject({ state: "failed", listing_id: null, position: null });
  expect(rowOf(rows, noor)).toMatchObject({ state: "answered", supported_count: 1, position: 1 });
  expect(countCalls(test, "persona_answer")).toBe(1);
  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("done");
});

it("W6-ASKW-T28 (design section 11, P8): a romantic help search asks only listings open to dating questions, and a plain one asks both", async () => {
  const rosa = await createAskPerson(fresh.db, { name: "Rosa", turns: ASK_TURNS.rosa });
  const tom = await createAskPerson(fresh.db, { name: "Tom", turns: ASK_TURNS.tom });
  await markPublic(fresh.db, rosa, [1]);
  await markPublic(fresh.db, tom, [1]);
  await listInDirectory(fresh.db, rosa, { line: ASK_LINES.rosa, isOpenToRomance: true });
  await listInDirectory(fresh.db, tom, { line: ASK_LINES.tom });
  const romantic = await insertHelpAsk(fresh.db, ana, "Ψάχνω κάποιον για ραντεβού που χορεύει σάλσα");
  const plain = await insertHelpAsk(fresh.db, ana, "Ποιος χορεύει σάλσα και θέλει παρέα για χορό;");
  const test = await openTest({ questionCheck: [ROMANTIC_HELP, ALLOWED_HELP], personaAnswers: { Rosa: ROSA_HELP }, judge: [allSupported(1), allSupported(1)] });

  await runAsk({ askId: romantic, personId: ana.personId }, test.context);
  await runAsk({ askId: plain, personId: ana.personId }, test.context);

  expect(await readAskRow(fresh.db, ana, romantic)).toMatchObject({ state: "done", question_kind: "romance" });
  expect((await readAnswerRows(fresh.db, ana, romantic)).map((row) => row.subject_display_name)).toEqual(["Rosa"]);
  expect(await readAskRow(fresh.db, ana, plain)).toMatchObject({ state: "done", question_kind: "help" });
  expect((await readAnswerRows(fresh.db, ana, plain)).map((row) => row.subject_display_name).sort()).toEqual(["Rosa", "Tom"]);
});

it("W6-ASKW-T29 (design section 11, P8): a listed person who turns dating questions off before their persona is asked gets a failed answer, using a fake full window", async () => {
  const iris = await createAskPerson(fresh.db, { name: "Iris", turns: ASK_TURNS.iris });
  await markPublic(fresh.db, iris, [1]);
  await listInDirectory(fresh.db, iris, { line: ASK_LINES.iris, isOpenToRomance: true });
  const askId = await insertHelpAsk(fresh.db, ana, "Βιολί ραντεβού Σάββατο");
  const payload = { askId, personId: ana.personId };
  const test = await openTest({ questionCheck: [ROMANTIC_HELP], personaAnswers: {}, judge: [], limiterBusy: { callSite: "persona_answer", times: 1 } });

  await runAsk(payload, test.context);
  await setRomanceSwitch(fresh.db, iris, false);
  await runAsk(payload, test.context);

  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => [row.subject_display_name, row.state])).toEqual([["Iris", "failed"]]);
  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({ state: "done", question_kind: "romance" });
  expect(countCalls(test, "persona_answer")).toBe(0);
});
