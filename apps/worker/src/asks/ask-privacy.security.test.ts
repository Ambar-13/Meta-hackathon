import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { makeDatabase, POOL_SIZE, type Database } from "@meet-first/db";
import { freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { runAsk } from "./run-ask-job.js";
import {
  ALLOWED_HELP, ALLOWED_REACT, ASK_LINES, ASK_TURNS, KAI_PUBLIC, allSupported, allowFriendAsks, createAskPerson, insertHelpAsk, insertReactAsk, joinInvitePair,
  listInDirectory, makeAskTestContext, markPublic, readAnswerRows, readAskRow, unapproveItem, userTexts, type AskPerson, type AskReplyScript, type AskTestContext,
} from "./testing/index.js";

// Any uuid: the shape of a person, card, item or turn id.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let ana: AskPerson;
let kai: AskPerson;
let kaiPair: string;
let strangerPair: string;
const contexts: AskTestContext[] = [];

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
  ana = await createAskPerson(fresh.db, { name: "Ana", turns: ASK_TURNS.ana });
  kai = await createAskPerson(fresh.db, { name: "Kai", turns: ASK_TURNS.kai, isRecallAllowed: true });
  const carol = await createAskPerson(fresh.db, { name: "Carol", turns: ASK_TURNS.noor });
  const dan = await createAskPerson(fresh.db, { name: "Dan", turns: ASK_TURNS.ivo });
  await markPublic(fresh.db, kai, [1]);
  await listInDirectory(fresh.db, kai, { line: ASK_LINES.kai });
  await allowFriendAsks(fresh.db, kai);
  kaiPair = await joinInvitePair(fresh.db, ana, kai);
  strangerPair = await joinInvitePair(fresh.db, carol, dan);
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

it("W6-ASKW-T34 (P1, P6, P7): a help request shows a stranger only the subject's public item, no recall although the switch is on, and no id", async () => {
  const askId = await insertHelpAsk(fresh.db, ana, "Who knows validation splits?");
  const test = await openTest({ questionCheck: [ALLOWED_HELP], personaAnswers: { Kai: KAI_PUBLIC }, judge: [allSupported(1)] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain('[t:0] value | Test claim 1 | "' + ASK_TURNS.kai[0] + '"');
  expect(request).not.toContain("[t:1]");
  expect(request).not.toContain("[t:2]");
  expect(request).not.toContain("[t:3]");
  expect(request).not.toContain("<recall_result>");
  expect(request).not.toMatch(UUID);
  expect((await readAnswerRows(fresh.db, ana, askId))[0]).toMatchObject({ state: "answered", claims: [{ verified: true, turnId: kai.turnIds[0] }] });
});

it("W6-ASKW-T35 (P3, P6): a friend ask naming a pair the asker is not in never reaches a persona, and the ask fails", async () => {
  const askId = await insertReactAsk(fresh.db, ana, { pairId: strangerPair, text: "How would Dan react to a late demo?", aboutName: "Dan" });
  const test = await openTest({ questionCheck: [ALLOWED_REACT], personaAnswers: {}, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("failed");
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual([]);
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});

it("W6-ASKW-T36 (P3): a friend request leaves out an item its owner took back, and keeps the approved ones", async () => {
  await unapproveItem(fresh.db, kai, 3);
  const askId = await insertReactAsk(fresh.db, ana, { pairId: kaiPair, text: "How would Kai react to a surprise demo on Friday?", aboutName: "Kai" });
  const test = await openTest({ questionCheck: [ALLOWED_REACT], personaAnswers: { Kai: KAI_PUBLIC }, judge: [allSupported(1)] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain('[t:0] value | Test claim 1 | "' + ASK_TURNS.kai[0] + '"');
  expect(request).toContain('[t:1] preference | Test claim 2 | "' + ASK_TURNS.kai[1] + '"');
  expect(request).not.toContain("[t:2] habit | Test claim 3 |");
});
