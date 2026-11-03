import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { makeDatabase, POOL_SIZE, type Database } from "@meet-first/db";
import { createTestPerson, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { runAsk } from "./run-ask-job.js";
import {
  ALLOWED_REACT, ASK_TURNS, countCalls, createAskPerson, insertSelfAsk, makeAskTestContext, readAnswerRows, seedReadySummary, userTexts, type AskReplyScript,
  type AskTestContext,
} from "./testing/index.js";

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
const contexts: AskTestContext[] = [];

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});

afterEach(async () => {
  for (const test of contexts.splice(0)) await test.close();
});

afterAll(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// Opens an ask test context over the worker database with this script, closed after the test.
async function openTest(script: AskReplyScript): Promise<AskTestContext> {
  const test = await makeAskTestContext({ db: workerDb, script });
  contexts.push(test);
  return test;
}

// A summary-only line, the way the check stores a point it did not find in the person's messages.
const CALLS_POINT = { kind: "avoid" as const, topic: "Calls", point: "Avoids phone calls and asks for a message instead.", strength: "moderate" as const, quotes: [], found: null };
// The persona's reply when only the summary covers the question.
const SUMMARY_TIER = { answer: "Nia likely prefers a message to a call, though this never came up in her chats.", has_sign: false, claims: [] };

it("W7-ASK-T24: a self ask makes one answer whose asker and subject are the person, from their card, recall and summary", async () => {
  const mia = await createAskPerson(fresh.db, { name: "Mia", turns: ASK_TURNS.kai, isRecallAllowed: true });
  await seedReadySummary(fresh.db, mia, { points: [CALLS_POINT], isFriendsOn: false });
  const askId = await insertSelfAsk(fresh.db, mia, "How would I react if the demo date moved to Friday?");
  const test = await openTest({ questionCheck: [ALLOWED_REACT], searchWords: [{ words: ["demo", "Friday"] }], personaAnswers: { Mia: SUMMARY_TIER }, judge: [] });

  await runAsk({ askId, personId: mia.personId }, test.context);

  const rows = await readAnswerRows(fresh.db, mia, askId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ mode: "self", asker_person_id: mia.personId, subject_person_id: mia.personId, subject_card_id: mia.cardId, state: "answered" });
  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain('<ask kind="self">How would I react if the demo date moved to Friday?</ask>');
  expect(request).toContain("<people>your human: Mia\nthe person asking: Mia</people>");
  expect(request).toContain("[t:3] " + ASK_TURNS.kai[3]);
  expect(request).toContain("<summary_only>\n- " + CALLS_POINT.point + "\n</summary_only>");
  expect(countCalls(test, "search_words")).toBe(1);
});

it("W7-ASK-T26: a person with a summary and no card gets a summary-tier answer", async () => {
  const nia = await createTestPerson(fresh.db, "Nia");
  const person = { personId: nia.personId, displayName: "Nia" };
  await seedReadySummary(fresh.db, person, { points: [CALLS_POINT], isFriendsOn: false });
  const askId = await insertSelfAsk(fresh.db, person, "Would I mind a quick call about the move?");
  const test = await openTest({ questionCheck: [ALLOWED_REACT], personaAnswers: { Nia: SUMMARY_TIER }, judge: [] });

  await runAsk({ askId, personId: nia.personId }, test.context);

  const rows = await readAnswerRows(fresh.db, person, askId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ mode: "self", subject_card_id: null, state: "answered", has_sign: false, answer: SUMMARY_TIER.answer });
  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain("<your_card>\n(no items)\n</your_card>");
  expect(request).toContain("<summary_only>\n- " + CALLS_POINT.point + "\n</summary_only>");
  expect(countCalls(test, "search_words")).toBe(0);
});
