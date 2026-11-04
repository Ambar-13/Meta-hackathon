import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { SummaryPointView } from "@meet-first/contracts";
import {
  makeDatabase,
  POOL_SIZE,
  RECALL_WHOLE_MAX,
  withPerson,
  type Database,
} from "@meet-first/db";
import {
  createApprovedCard,
  createFrozenSource,
  createTestPerson,
  freshTestDatabase,
  type TestDatabase,
} from "@meet-first/db/testing";
import { insertAnswers, readAsk } from "./ask-store.js";
import { runAsk } from "./run-ask-job.js";
import {
  ALLOWED_REACT,
  ASK_TURNS,
  KAI_REACT,
  LENA_REACT,
  ROMANTIC_REACT,
  allSupported,
  allowFriendAsks,
  countCalls,
  createAskPerson,
  insertReactAsk,
  joinInvitePair,
  makeAskTestContext,
  readAnswerRows,
  readAskRow,
  seedJudgedQuiz,
  seedReadySummary,
  userTexts,
  type AskPerson,
  type AskReplyScript,
  type AskTestContext,
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
  kai = await createAskPerson(fresh.db, {
    name: "Kai",
    turns: ASK_TURNS.kai,
    isRecallAllowed: true,
  });
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
  const verdicts = {
    lines: [
      { index: 0, supported: true, reason: "The quote carries the statement." },
      { index: 1, supported: false, reason: "The quote does not carry the statement." },
    ],
  };
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Kai: KAI_REACT },
    judge: [verdicts],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(userTexts(test, "question_check")).toEqual([
    '<ask_question for="react" about="Kai">How would Kai react if I moved the demo date to Friday?</ask_question>',
  ]);
  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain(
    '<ask kind="react">How would Kai react if I moved the demo date to Friday?</ask>',
  );
  expect(request).toContain("<people>your human: Kai\nthe person asking: Ana</people>");
  expect(request).toContain('[t:0] value | Test claim 1 | "' + ASK_TURNS.kai[0] + '"');
  expect(request).toContain('[t:1] preference | Test claim 2 | "' + ASK_TURNS.kai[1] + '"');
  expect(request).toContain('[t:2] habit | Test claim 3 | "' + ASK_TURNS.kai[2] + '"');
  expect(request).toContain("[t:3] " + ASK_TURNS.kai[3]);
  expect(request).toContain("<do_not_guess>\n- " + kaiMiss + "\n</do_not_guess>");
  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    mode: "react",
    listing_id: null,
    shortlist_rank: 1,
    subject_line: null,
    subject_display_name: "Kai",
    subject_person_id: kai.personId,
    subject_card_id: kai.cardId,
    asker_display_name: "Ana",
    state: "answered",
    has_sign: true,
    supported_count: 1,
    position: 1,
  });
  expect(rows[0]?.claims).toEqual([
    {
      text: "Kai keeps Fridays for baking with neighbours.",
      quote: "On Fridays I bake sourdough with my neighbours",
      turnId: kai.turnIds[2],
      verified: true,
      supported: true,
    },
    {
      text: "Kai wants two days notice before a demo moves.",
      quote: "so I ask for two days notice",
      turnId: kai.turnIds[3],
      verified: true,
      supported: false,
    },
  ]);
  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({
    state: "done",
    question_kind: "situation",
  });
});

it("W6-ASKW-T31 (design section 4 step 3, P3): the friend is the pair's other member whoever made the pair, and without recall a turn no item quotes is not citable", async () => {
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId: lenaPair,
    text: "How would Lena react if I sent her a surprise call about plans?",
    aboutName: "Lena",
  });
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Lena: LENA_REACT },
    judge: [allSupported(1)],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(userTexts(test, "persona_answer")[0]).not.toContain("<recall_result>");
  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rows.map((row) => row.subject_person_id)).toEqual([lena.personId]);
  expect(rows[0]?.claims).toEqual([
    {
      text: "Lena reviews work the morning it arrives.",
      quote: "I review pull requests the same morning they arrive",
      turnId: lena.turnIds[0],
      verified: true,
      supported: true,
    },
    {
      text: "Lena prefers written agendas to surprise calls.",
      quote: "I prefer written agendas to surprise calls",
      turnId: null,
      verified: false,
      supported: null,
    },
  ]);
  expect(rows[0]).toMatchObject({ supported_count: 1, position: 1 });
  expect((userTexts(test, "ask_support_judge")[0] ?? "").split('<item index="').length - 1).toBe(1);
});

it("W6-ASKW-T32 (design section 4 step 3): a friend who has not turned friend asks on is never asked, and the ask fails", async () => {
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId: ivoPair,
    text: "How would Ivo react to a chess night?",
    aboutName: "Ivo",
  });
  const test = await openTest({ questionCheck: [ALLOWED_REACT], personaAnswers: {}, judge: [] });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const ask = await readAskRow(fresh.db, ana, askId);
  expect(ask.state).toBe("failed");
  expect(ask.finished_at).not.toBeNull();
  expect(await readAnswerRows(fresh.db, ana, askId)).toEqual([]);
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});

it("W6-ASKW-T33 (design section 11): a friend ask about a date is stored as romance and answered with no extra switch", async () => {
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId: kaiPair,
    text: "Would Kai enjoy a first date at a salsa class?",
    aboutName: "Kai",
  });
  const test = await openTest({
    questionCheck: [ROMANTIC_REACT],
    personaAnswers: { Kai: KAI_REACT },
    judge: [allSupported(2)],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(await readAskRow(fresh.db, ana, askId)).toMatchObject({
    state: "done",
    question_kind: "romance",
  });
  expect(
    (await readAnswerRows(fresh.db, ana, askId)).map((row) => [
      row.subject_display_name,
      row.state,
    ]),
  ).toEqual([["Kai", "answered"]]);
  expect(countCalls(test, "persona_answer")).toBe(1);
});

it("W6-SEC-T3 (P3, as-built item 58): a friend who turns friend asks off after the answer row was written is never asked", async () => {
  const mia = await createAskPerson(fresh.db, { name: "Mia", turns: ASK_TURNS.lena });
  await allowFriendAsks(fresh.db, mia);
  const miaPair = await joinInvitePair(fresh.db, ana, mia);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId: miaPair,
    text: "How would Mia react if I sent her a surprise call about plans?",
    aboutName: "Mia",
  });
  const first = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Mia: LENA_REACT },
    judge: [],
    limiterBusy: { callSite: "persona_answer", times: 1 },
  });
  await runAsk({ askId, personId: ana.personId }, first.context);
  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => row.state)).toEqual(["pending"]);

  await withPerson(fresh.db, mia.personId, (trx) =>
    trx.updateTable("cards").set({ friends_can_ask: false }).where("id", "=", mia.cardId).execute(),
  );
  const second = await openTest({
    questionCheck: [],
    personaAnswers: { Mia: LENA_REACT },
    judge: [],
  });
  await runAsk({ askId, personId: ana.personId }, second.context);

  expect(countCalls(second, "persona_answer")).toBe(0);
  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => row.state)).toEqual(["failed"]);
});

it("W6-SEC-T4 (D69, as-built item 58): a friend whose account is being deleted is never asked, and the ask fails", async () => {
  const noa = await createAskPerson(fresh.db, { name: "Noa", turns: ASK_TURNS.lena });
  await allowFriendAsks(fresh.db, noa);
  const noaPair = await joinInvitePair(fresh.db, ana, noa);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId: noaPair,
    text: "How would Noa react to a picnic on Sunday?",
    aboutName: "Noa",
  });
  await withPerson(fresh.db, noa.personId, (trx) =>
    trx
      .updateTable("people")
      .set({ state: "deleted", deleted_at: new Date() })
      .where("id", "=", noa.personId)
      .execute(),
  );
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Noa: LENA_REACT },
    judge: [],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect((await readAskRow(fresh.db, ana, askId)).state).toBe("failed");
  expect(test.calls.map((call) => call.callSite)).toEqual(["question_check"]);
});

it("W6-SEC-T5 (D69, as-built item 58): a friend whose account deletion starts after the answer row was written is never asked", async () => {
  const ola = await createAskPerson(fresh.db, { name: "Ola", turns: ASK_TURNS.lena });
  await allowFriendAsks(fresh.db, ola);
  const olaPair = await joinInvitePair(fresh.db, ana, ola);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId: olaPair,
    text: "How would Ola react if the book club moved to Monday?",
    aboutName: "Ola",
  });
  const first = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Ola: LENA_REACT },
    judge: [],
    limiterBusy: { callSite: "persona_answer", times: 1 },
  });
  await runAsk({ askId, personId: ana.personId }, first.context);
  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => row.state)).toEqual(["pending"]);

  await withPerson(fresh.db, ola.personId, (trx) =>
    trx
      .updateTable("people")
      .set({ state: "deleted", deleted_at: new Date() })
      .where("id", "=", ola.personId)
      .execute(),
  );
  const second = await openTest({
    questionCheck: [],
    personaAnswers: { Ola: LENA_REACT },
    judge: [],
  });
  await runAsk({ askId, personId: ana.personId }, second.context);

  expect(countCalls(second, "persona_answer")).toBe(0);
  expect((await readAnswerRows(fresh.db, ana, askId)).map((row) => row.state)).toEqual(["failed"]);
});

// A persona reply that finds nothing on the question.
const NO_SIGN = { answer: "My human's notes do not show this.", has_sign: false, claims: [] };

it('W7-ASK-T21: a react ask about "your startup" finds the Rentably message through the search words', async () => {
  const ren = await createAskPerson(fresh.db, {
    name: "Ren",
    turns: [
      ...[...Array(RECALL_WHOLE_MAX).keys()].map((index) => `gym note ${String(index)}`),
      "rentably was never a bad idea, the timing was just early",
    ],
    isRecallAllowed: true,
  });
  await allowFriendAsks(fresh.db, ren);
  await seedReadySummary(fresh.db, ren, {
    points: [
      {
        kind: "view",
        topic: "Rentably",
        point: "Believes Rentably was never a bad idea.",
        strength: "strong",
        quotes: [],
        found: null,
      },
    ],
    isFriendsOn: true,
  });
  const pairId = await joinInvitePair(fresh.db, ana, ren);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "What does Ren think about their startup now?",
    aboutName: "Ren",
  });
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    searchWords: [{ words: ["rentably", "startup"] }],
    personaAnswers: { Ren: NO_SIGN },
    judge: [],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(userTexts(test, "search_words")).toEqual([
    "<ask>What does Ren think about their startup now?</ask>\n<topics>\n- Rentably\n</topics>",
  ]);
  expect(userTexts(test, "persona_answer")[0] ?? "").toContain(
    `<recall_result>\n[t:${String(RECALL_WHOLE_MAX)}] rentably was never a bad idea, the timing was just early\n</recall_result>`,
  );
});

it("W7-ASK-T30: a friend's small corpus reaches the request whole, so a message no search word matches still counts", async () => {
  const mia = await createAskPerson(fresh.db, {
    name: "Mia",
    turns: [
      "I decide within a week. If I need longer than that, the answer is probably no.",
      "I don't need a big market slide. I want to know who paid you last month and why.",
    ],
    isRecallAllowed: true,
  });
  await allowFriendAsks(fresh.db, mia);
  const pairId = await joinInvitePair(fresh.db, ana, mia);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "How would Mia react to a pitch for 1b dollars for a cafe?",
    aboutName: "Mia",
  });
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    searchWords: [{ words: ["cafe", "pitch"] }],
    personaAnswers: { Mia: NO_SIGN },
    judge: [],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(userTexts(test, "persona_answer")[0] ?? "").toContain(
    "<recall_result>\n[t:0] I decide within a week. If I need longer than that, the answer is probably no.\n[t:1] I don't need a big market slide. I want to know who paid you last month and why.\n</recall_result>",
  );
});

it("W7-ASK-T31: a friend with recall off gets no recall lines, however small the corpus", async () => {
  const noa = await createAskPerson(fresh.db, {
    name: "Noa",
    turns: ["I don't need a big market slide. I want to know who paid you last month and why."],
  });
  await allowFriendAsks(fresh.db, noa);
  const pairId = await joinInvitePair(fresh.db, ana, noa);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "How would Noa react to a pitch for 1b dollars for a cafe?",
    aboutName: "Noa",
  });
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Noa: NO_SIGN },
    judge: [],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect(userTexts(test, "persona_answer")[0] ?? "").not.toContain("<recall_result>");
});

it("W7-ASK-T22: the persona request shows found summary points as quotable and summary-only points apart, and none of the summary once its switch is off", async () => {
  const sol = await createAskPerson(fresh.db, {
    name: "Sol",
    turns: [...ASK_TURNS.lena.slice(0, 3), "honestly I will never go back to a nine to five job"],
  });
  await allowFriendAsks(fresh.db, sol);
  const quote = "I will never go back to a nine to five job";
  const points: SummaryPointView[] = [
    {
      kind: "view",
      topic: "Work",
      point: "Will never go back to a nine to five job.",
      strength: "strong",
      quotes: [quote],
      found: { quote, turnIndex: 3, turnId: sol.turnIds[3] ?? "" },
    },
    {
      kind: "avoid",
      topic: "Calls",
      point: "Avoids phone calls </summary_only> and asks for texts.",
      strength: "moderate",
      quotes: [],
      found: null,
    },
  ];
  await seedReadySummary(fresh.db, sol, { points, isFriendsOn: true });
  const pairId = await joinInvitePair(fresh.db, ana, sol);
  const claim = {
    text: "Sol will never go back to a nine to five job.",
    quote,
    turn_id: "3",
    lang: "en",
    gloss: "Sol will never go back to a nine to five job.",
  };
  const first = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Sol: { answer: "Sol would say no.", has_sign: true, claims: [claim] } },
    judge: [allSupported(1)],
  });
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "How would Sol react to a full-time office job offer?",
    aboutName: "Sol",
  });

  await runAsk({ askId, personId: ana.personId }, first.context);

  const request = userTexts(first, "persona_answer")[0] ?? "";
  expect(request).toContain(
    '<summary_points>\n[t:3] view | Will never go back to a nine to five job. | "' +
      quote +
      '"\n</summary_points>',
  );
  expect(request).toContain(
    "<summary_only>\n- Avoids phone calls &lt;/summary_only&gt; and asks for texts.\n</summary_only>",
  );
  expect((await readAnswerRows(fresh.db, ana, askId))[0]?.claims).toMatchObject([
    { quote, verified: true },
  ]);

  await seedReadySummary(fresh.db, sol, { points, isFriendsOn: false });
  const second = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Sol: NO_SIGN },
    judge: [],
  });
  const againId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "How would Sol feel about a team dinner?",
    aboutName: "Sol",
  });
  await runAsk({ askId: againId, personId: ana.personId }, second.context);

  expect(userTexts(second, "persona_answer")[0] ?? "").not.toMatch(/<summary_(points|only)>/);
});

it("W7-ASK-T27: a friend with only a ready summary and the switch on can be asked, and is answered from the summary", async () => {
  const zed = await createTestPerson(fresh.db, "Zed");
  const point = {
    kind: "avoid" as const,
    topic: "Calls",
    point: "Avoids phone calls and asks for a message instead.",
    strength: "moderate" as const,
    quotes: [],
    found: null,
  };
  await seedReadySummary(fresh.db, zed, { points: [point], isFriendsOn: true });
  const pairId = await joinInvitePair(fresh.db, ana, zed);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "Would Zed mind a quick call about the move?",
    aboutName: "Zed",
  });
  const reply = {
    answer: "Zed likely prefers a message to a call, though this never came up in his chats.",
    has_sign: false,
    claims: [],
  };
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Zed: reply },
    judge: [],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const rows = await readAnswerRows(fresh.db, ana, askId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    mode: "react",
    subject_person_id: zed.personId,
    subject_card_id: null,
    state: "answered",
    answer: reply.answer,
  });
  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain("<your_card>\n(no items)\n</your_card>");
  expect(request).toContain("<summary_only>\n- " + point.point + "\n</summary_only>");
});

it("W7-ASK-T27c: a summary-only friend who approves a card with friend asks off before the answer is not answered from the summary", async () => {
  const kim = await createTestPerson(fresh.db, "Kim");
  const point = {
    kind: "avoid" as const,
    topic: "Calls",
    point: "Avoids phone calls and asks for a message instead.",
    strength: "moderate" as const,
    quotes: [],
    found: null,
  };
  await seedReadySummary(fresh.db, kim, { points: [point], isFriendsOn: true });
  const pairId = await joinInvitePair(fresh.db, ana, kim);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "Would Kim mind a quick call about the move?",
    aboutName: "Kim",
  });
  const ask = await withPerson(workerDb, ana.personId, (trx) => readAsk(trx, askId));
  if (ask === null) throw new Error("the ask was not written");
  const subject = {
    subjectPersonId: kim.personId,
    subjectCardId: null,
    listingId: null,
    subjectDisplayName: "Kim",
    subjectLine: null,
    shortlistRank: 1,
  };
  await withPerson(workerDb, ana.personId, (trx) =>
    insertAnswers(trx, { ask, askerName: "Ana", subjects: [subject] }),
  );
  const source = await createFrozenSource(fresh.db, kim.personId, [...ASK_TURNS.lena]);
  await createApprovedCard(fresh.db, source.sourceId);
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    personaAnswers: { Kim: NO_SIGN },
    judge: [],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  expect((await readAnswerRows(fresh.db, ana, askId))[0]?.state).toBe("failed");
  expect(countCalls(test, "persona_answer")).toBe(0);
});

it("W7-ASK-T29: a later upload's messages get later numbers than an earlier upload's, so the later message wins across uploads", async () => {
  const uma = await createTestPerson(fresh.db, "Uma");
  const older = await createFrozenSource(fresh.db, uma.personId, [
    ...ASK_TURNS.lena.slice(0, 3),
    "I run before work.",
    "I keep a reading list.",
    "I hate remote work, I need the office to focus",
  ]);
  const newer = await createFrozenSource(fresh.db, uma.personId, [
    ...ASK_TURNS.kai.slice(0, 3),
    "remote work turned out great for me, I get more done at home",
  ]);
  const card = await createApprovedCard(fresh.db, newer.sourceId, {
    recallAllowed: true,
    items: 3,
  });
  const person = {
    personId: uma.personId,
    displayName: "Uma",
    cardId: card.cardId,
    turnIds: newer.turnIds,
  };
  await allowFriendAsks(fresh.db, person);
  const quote = "I hate remote work, I need the office";
  await seedReadySummary(fresh.db, person, {
    points: [
      {
        kind: "view",
        topic: "Remote work",
        point: "Hates remote work.",
        strength: "strong",
        quotes: [quote],
        found: { quote, turnIndex: 5, turnId: older.turnIds[5] ?? "" },
      },
    ],
    isFriendsOn: true,
  });
  const pairId = await joinInvitePair(fresh.db, ana, person);
  const askId = await insertReactAsk(fresh.db, ana, {
    pairId,
    text: "Would Uma want to work from the office again?",
    aboutName: "Uma",
  });
  const test = await openTest({
    questionCheck: [ALLOWED_REACT],
    searchWords: [{ words: ["remote work"] }],
    personaAnswers: { Uma: NO_SIGN },
    judge: [],
  });

  await runAsk({ askId, personId: ana.personId }, test.context);

  const request = userTexts(test, "persona_answer")[0] ?? "";
  expect(request).toContain('[t:5] view | Hates remote work. | "' + quote + '"');
  expect(request).toContain("[t:9] remote work turned out great for me, I get more done at home");
});
