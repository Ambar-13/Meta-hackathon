import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { makeDatabase, POOL_SIZE, type Database } from "@meet-first/db";
import { freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { runAsk } from "./run-ask-job.js";
import {
  ALLOWED_REACT, ASK_TURNS, KAI_REACT, LENA_REACT, ROMANTIC_REACT, allSupported, allowFriendAsks, countCalls, createAskPerson, insertReactAsk, joinInvitePair,
  makeAskTestContext, readAnswerRows, readAskRow, seedJudgedQuiz, userTexts, type AskPerson, type AskReplyScript, type AskTestContext,
} from "./testing/index.js";

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
let ana: AskPerson;
let kai: AskPerson;
let lena: AskPerson;
let kaiPair: string;
let lenaPair: string;
let ivoPair: string;
let kaiMiss: string;
const contexts: AskTestContext[] = [];

beforeAll(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
  ana = await createAskPerson(fresh.db, { name: "Ana", turns: ASK_TURNS.ana });
  kai = await createAskPerson(fresh.db, { name: "Kai", turns: ASK_TURNS.kai, isRecallAllowed: true });
  lena = await createAskPerson(fresh.db, { name: "Lena", turns: ASK_TURNS.lena });
  const ivo = await createAskPerson(fresh.db, { name: "Ivo", turns: ASK_TURNS.ivo });
  await allowFriendAsks(fresh.db, kai);
  await allowFriendAsks(fresh.db, lena);
  kaiPair = await joinInvitePair(fresh.db, ana, kai);
  lenaPair = await joinInvitePair(fresh.db, lena, ana);
  ivoPair = await joinInvitePair(fresh.db, ana, ivo);
  kaiMiss = await seedJudgedQuiz(workerDb, kai);
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

it("W6-ASKW-T30 (design section 4, P3, D31, D38): a friend ask uses the friend's whole approved card, recall and quiz misses, and checks and judges both claims", async () => {
  const text = "How would Kai react if I moved the demo date to Friday?";
  const askId = await insertReactAsk(fresh.db, ana, { pairId: kaiPair, text, aboutName: "Kai" });
  const verdicts = { lines: [{ index: 0, supported: true, reason: "The quote carries the statement." }, { index: 1, supported: false, reason: "The quote does not carry the statement." }] };
  const test = await openTest({ questionCheck: [ALLOWED_REACT], personaAnswers: { Kai: KAI_REACT }, judge: [verdicts] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(userTexts(test, "question_check")).toEqual(['<ask_question for="react" about="Kai">How would Kai react if I moved the demo date to Friday?</ask_question>']);
  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain('<ask kind="react">How would Kai react if I moved the demo date to Friday?</ask>');
  expect(request).toContain("<people>your human: Kai\nthe person asking: Ana</people>");
  expect(request).toContain('[t:0] value | Test claim 1 | "' + ASK_TURNS.kai[0] + '"');
  expect(request).toContain('[t:1] preference | Test claim 2 | "' + ASK_TURNS.kai[1] + '"');
  expect(request).toContain('[t:2] habit | Test claim 3 | "' + ASK_TURNS.kai[2] + '"');
  expect(request).toContain("[t:3] " + ASK_TURNS.kai[3]);
  expect(request).toContain("<do_not_guess>\n- " + kaiMiss + "\n</do_not_guess>");
  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    mode: "react", listing_id: null, shortlist_rank: 1, subject_line: null, subject_display_name: "Kai", subject_person_id: kai.personId, subject_card_id: kai.cardId,
    asker_display_name: "Ana", state: "answered", has_sign: true, supported_count: 1, position: 1,
  });
  expect(rows[0]?.claims).toEqual([
    { text: "Kai keeps Fridays for baking with neighbours.", quote: "On Fridays I bake sourdough with my neighbours", turnId: kai.turnIds[2], verified: true, supported: true },
    { text: "Kai wants two days notice before a demo moves.", quote: "so I ask for two days notice", turnId: kai.turnIds[3], verified: true, supported: false },
  ]);
  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({ state: "done", question_kind: "situation" });
});

it("W6-ASKW-T31 (design section 4 step 3, P3): the friend is the pair's other member whoever made the pair, and without recall a turn no item quotes is not citable", async () => {
  const askId = await insertReactAsk(fresh.db, ana, { pairId: lenaPair, text: "How would Lena react if I sent her a surprise call about plans?", aboutName: "Lena" });
  const test = await openTest({ questionCheck: [ALLOWED_REACT], personaAnswers: { Lena: LENA_REACT }, judge: [allSupported(1)] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(userTexts(test, "persona_answer")[0]).not.toContain("<recall_result>");
  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rows.map((row) => row.subject_person_id)).toEqual([lena.personId]);
  expect(rows[0]?.claims).toEqual([
    { text: "Lena reviews work the morning it arrives.", quote: "I review pull requests the same morning they arrive", turnId: lena.turnIds[0], verified: true, supported: true },
    { text: "Lena prefers written agendas to surprise calls.", quote: "I prefer written agendas to surprise calls", turnId: null, verified: false, supported: null },
  ]);
  expect(rows[0]).toMatchObject({ supported_count: 1, position: 1 });
  expect((userTexts(test, "ask_support_judge")[0] ?? "").split('<item index="').length - 1).toBe(1);
});

it("W6-ASKW-T32 (design section 4 step 3): a friend who has not turned friend asks on is never asked, and the ask fails", async () => {
  const askId = await insertReactAsk(fresh.db, ana, { pairId: ivoPair, text: "How would Ivo react to a chess night?", aboutName: "Ivo" });
  const test = await openTest({ questionCheck: [ALLOWED_REACT], personaAnswers: {}, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const ask = await readAskRow(fresh.db, ana, askId);
  expect(ask.state).toBe("failed");
  expect(ask.finished_at).not.toBeNull();
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual([]);
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});

it("W6-ASKW-T33 (design section 11): a friend ask about a date is stored as romance and answered with no extra switch", async () => {
  const askId = await insertReactAsk(fresh.db, ana, { pairId: kaiPair, text: "Would Kai enjoy a first date at a salsa class?", aboutName: "Kai" });
  const test = await openTest({ questionCheck: [ROMANTIC_REACT], personaAnswers: { Kai: KAI_REACT }, judge: [allSupported(2)] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({ state: "done", question_kind: "romance" });
  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => [row.subject_display_name, row.state])).toEqual([["Kai", "answered"]]);
  expect(countCalls(test, "persona_answer")).toBe(1);
});
