import { existsSync } from "node:fs";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobPayloads, QUIZ_BANK, QuizCalibrationRaw, QuizJudgeRaw } from "@meet-first/contracts";
import { makeDatabase, numberFromPostgres, POOL_SIZE, withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import { createApprovedCard, createFrozenSource, createTestPerson, freshTestDatabase, type TestDatabase } from "@meet-first/db/testing";
import { requestHash } from "@meet-first/llm";
import { readPrompt, type Prompt } from "@meet-first/prompts";
import { normQuote } from "@meet-first/receipts";
import { makeTestJobContext, recordedReplyPath } from "../testing/index.js";
import { answerQuizTask } from "./answer-quiz-job.js";
import { quizMisses } from "./calibration.js";
import { judgeQuizTask } from "./judge-quiz-job.js";
import {
  AGREE_REASON, DISAGREE_REASON, FIXTURE_CARD_ITEMS, FIXTURE_FLIPPED_POSITIONS, FIXTURE_HUMAN_ANSWER_6_VARIANT, FIXTURE_HUMAN_ANSWERS,
  FIXTURE_PERSONA_ANSWERS, FIXTURE_QUESTION_IDS, FIXTURE_QUIZ_IDS, FIXTURE_TURNS, RUN_1_VERDICTS, RUN_2_VERDICTS, fixtureCases, requestBodyFor,
} from "./quiz-fixtures.js";
import { requireElement } from "./quiz-requests.js";

let database: TestDatabase;
let workerDb: Kysely<Database>;
let personaPrompt: Prompt;
let judgePrompt: Prompt;

beforeAll(async () => {
  database = await freshTestDatabase();
  workerDb = makeDatabase(database.workerUrl, POOL_SIZE.test);
  personaPrompt = readPrompt("quiz-persona-answer");
  judgePrompt = readPrompt("quiz-judge");
});

afterAll(async () => {
  await workerDb.destroy();
  await database.drop();
});

// The persona answers a set-up writes: all ten, none, or all except one position.
type PersonaAnswers = "all" | "none" | { allExcept: number };
// The options of one quiz set-up; a test names only the parts it changes.
type SetUpOptions = { quizId?: string; state: "answering" | "waiting_human" | "judging" | "judged" | "failed"; personaAnswers: PersonaAnswers; humanAnswers: "all" | "none"; unapprovedPositions?: number[]; withoutQuiz?: boolean; questionIdAt?: { position: number; questionId: number }; humanAnswerAt6?: string; verdicts?: readonly boolean[]; reliable?: boolean };
// The ids a set-up gives back; quizId is null when the test skipped the quiz.
type SetUp = { personId: string; cardId: string; quizId: string | null };

// The question id one position asks in this set-up: the fixed id, or the id the test names for that position.
function questionIdFor(options: SetUpOptions, position: number): number {
  const questionAt = options.questionIdAt;
  if (questionAt !== undefined && questionAt.position === position) return questionAt.questionId;
  return requireElement(FIXTURE_QUESTION_IDS, position - 1);
}

// The persona answer of one position in this set-up, or null when the set-up leaves it unanswered.
function personaAnswerFor(personaAnswers: PersonaAnswers, position: number): string | null {
  const isAnswered = personaAnswers === "all" || (typeof personaAnswers === "object" && personaAnswers.allExcept !== position);
  return isAnswered ? requireElement(FIXTURE_PERSONA_ANSWERS, position - 1) : null;
}

// The human answer of one position in this set-up: the fixture answer, the position 6 variant when named, or null.
function humanAnswerFor(options: SetUpOptions, position: number): string | null {
  if (options.humanAnswers !== "all") return null;
  if (position === 6 && options.humanAnswerAt6 !== undefined) return options.humanAnswerAt6;
  return requireElement(FIXTURE_HUMAN_ANSWERS, position - 1);
}

// Replaces the card's items with the six fixture items, unapproved at the positions the set-up names.
async function insertCardItems(trx: DatabaseTransaction, args: { cardId: string; personId: string; turnIds: readonly string[]; unapproved: readonly number[] }): Promise<void> {
  await trx.deleteFrom("card_items").where("card_id", "=", args.cardId).execute();
  const rows = FIXTURE_CARD_ITEMS.map((item) => ({
    card_id: args.cardId, person_id: args.personId, position: item.position, kind: item.kind, claim: item.claim, lang: "en", gloss: item.gloss,
    turn_id: requireElement(args.turnIds, item.position - 1), quote: item.quote, norm_quote: normQuote(item.quote), verified: true, flagged: false,
    sensitive: false, approved: !args.unapproved.includes(item.position),
  }));
  await trx.insertInto("card_items").values(rows).execute();
}

// Writes the quiz row and its ten items as the set-up describes them, and returns the quiz id.
async function insertQuizRows(trx: DatabaseTransaction, args: { options: SetUpOptions; personId: string; cardId: string }): Promise<string> {
  const { options, personId, cardId } = args;
  const verdicts = options.verdicts;
  const matched = (verdicts ?? RUN_1_VERDICTS).filter((agree) => agree).length;
  const judgedColumns = options.state === "judged" ? { matched, reliable: options.reliable ?? true, judge_runs: 1, judged_at: new Date() } : {};
  const quiz = await trx
    .insertInto("quizzes")
    .values({ ...(options.quizId === undefined ? {} : { id: options.quizId }), card_id: cardId, person_id: personId, bank_version: 1, seed: cardId, state: options.state, ...judgedColumns })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (let position = 1; position <= 10; position += 1) {
    await trx
      .insertInto("quiz_items")
      .values({
        quiz_id: quiz.id, person_id: personId, position, bank_version: 1, question_id: questionIdFor(options, position),
        flipped: FIXTURE_FLIPPED_POSITIONS.has(position), persona_answer: personaAnswerFor(options.personaAnswers, position),
        human_answer: humanAnswerFor(options, position), agree: verdicts === undefined ? null : requireElement(verdicts, position - 1),
      })
      .execute();
  }
  return quiz.id;
}

// Writes one person, a frozen source, an approved card with the six fixture items, and a quiz in the state the test names.
async function setUpQuiz(options: SetUpOptions): Promise<SetUp> {
  const owner = await createTestPerson(database.db, "Quiz Owner");
  const source = await createFrozenSource(database.db, owner.personId, [...FIXTURE_TURNS]);
  const card = await createApprovedCard(database.db, source.sourceId, { items: 6 });
  return withPerson(workerDb, owner.personId, async (trx) => {
    await insertCardItems(trx, { cardId: card.cardId, personId: owner.personId, turnIds: source.turnIds, unapproved: options.unapprovedPositions ?? [] });
    if (options.withoutQuiz === true) return { personId: owner.personId, cardId: card.cardId, quizId: null };
    const quizId = await insertQuizRows(trx, { options, personId: owner.personId, cardId: card.cardId });
    return { personId: owner.personId, cardId: card.cardId, quizId };
  });
}

// Reads the quiz row as its owner, through the worker connection.
async function readQuiz(personId: string, quizId: string) {
  return withPerson(workerDb, personId, (trx) => trx.selectFrom("quizzes").selectAll().where("id", "=", quizId).executeTakeFirstOrThrow());
}

// Reads the ten items of a quiz in position order, as the owner.
async function readItems(personId: string, quizId: string) {
  return withPerson(workerDb, personId, (trx) => trx.selectFrom("quiz_items").selectAll().where("quiz_id", "=", quizId).orderBy("position", "asc").execute());
}

// Counts the ledger rows of one call site for a person, as the owner.
async function countLedger(personId: string, callSite: "quiz_answer" | "quiz_judge"): Promise<number> {
  const row = await withPerson(workerDb, personId, (trx) =>
    trx.selectFrom("ledger").select((eb) => eb.fn.countAll<string>().as("n")).where("person_id", "=", personId).where("call_site", "=", callSite).executeTakeFirstOrThrow(),
  );
  return numberFromPostgres(row.n);
}

// Writes one ledger row for a person as the owner, so a test can fill the limiter window or the daily dollar cap.
async function plantLedgerRow(personId: string, values: { estTokens: number; usd?: number; status: "started" | "ok" }): Promise<string> {
  const row = await withPerson(workerDb, personId, (trx) => trx.insertInto("ledger").values({ person_id: personId, meeting_id: null, call_site: "quiz_answer", model: "muse-spark-1.3", effort: "low", est_tokens: values.estTokens, usd: values.usd ?? 0, status: values.status, llm_mode: "replay" }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

// Deletes one ledger row as the owner, so the next test has room in the limiter window again.
async function removeLedgerRow(personId: string, ledgerId: string): Promise<void> {
  await withPerson(workerDb, personId, (trx) => trx.deleteFrom("ledger").where("id", "=", ledgerId).execute());
}

// The quiz id a set-up wrote; every set-up that reaches a job writes one.
function quizIdOf(set: SetUp): string {
  if (set.quizId === null) throw new Error("the set-up wrote no quiz");
  return set.quizId;
}

describe("quiz jobs replay recorded replies and write their rows", () => {
  it("D74-T1: every quiz fixture case has its recorded reply file", () => {
    const cases = fixtureCases();
    expect(cases).toHaveLength(43);
    expect(cases.filter((fixture) => fixture.callSite === "quiz_answer")).toHaveLength(12);
    expect(cases.filter((fixture) => fixture.callSite === "quiz_judge")).toHaveLength(31);
    const promptFor = (callSite: string) => (callSite === "quiz_answer" ? personaPrompt : judgePrompt);
    const missing = cases.filter((fixture) => !existsSync(recordedReplyPath(fixture.callSite, requestHash(requestBodyFor(fixture.call(promptFor(fixture.callSite))))))).map((fixture) => fixture.id);
    expect(missing).toEqual([]);
  });

  it("R4.1-T4: the answer job writes ten persona answers from the card and opens the quiz for the human", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ state: "answering", personaAnswers: "none", humanAnswers: "none" });
    const quizId = quizIdOf(set);

    await answerQuizTask(JobPayloads.answer_quiz.parse({ quizId, personId: set.personId }), context);

    expect((await readQuiz(set.personId, quizId)).state).toBe("waiting_human");
    const items = await readItems(set.personId, quizId);
    expect(items.map((item) => item.persona_answer)).toEqual(FIXTURE_PERSONA_ANSWERS);
    expect(items.every((item) => item.human_answer === null && item.agree === null)).toBe(true);
    expect(await countLedger(set.personId, "quiz_answer")).toBe(10);
    const rows = await withPerson(workerDb, set.personId, (trx) => trx.selectFrom("ledger").select(["status", "llm_mode"]).where("person_id", "=", set.personId).execute());
    expect(rows.every((row) => row.status === "ok" && row.llm_mode === "replay")).toBe(true);
  });

  it("R4.1-T5: an item the person did not approve never reaches the persona", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ state: "answering", personaAnswers: { allExcept: 7 }, humanAnswers: "none", unapprovedPositions: [6] });
    const quizId = quizIdOf(set);

    await answerQuizTask(JobPayloads.answer_quiz.parse({ quizId, personId: set.personId }), context);

    expect(requireElement(await readItems(set.personId, quizId), 6).persona_answer).toBe("My card does not say.");
    expect((await readQuiz(set.personId, quizId)).state).toBe("waiting_human");
    expect(await countLedger(set.personId, "quiz_answer")).toBe(1);
  });

  it("R4.1-T6: a card with no usable item marks the quiz failed without a model call", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ state: "answering", personaAnswers: "none", humanAnswers: "none", unapprovedPositions: [1, 2, 3, 4, 5, 6] });
    const quizId = quizIdOf(set);

    await answerQuizTask(JobPayloads.answer_quiz.parse({ quizId, personId: set.personId }), context);

    expect((await readQuiz(set.personId, quizId)).state).toBe("failed");
    expect((await readItems(set.personId, quizId)).every((item) => item.persona_answer === null)).toBe(true);
    expect(await countLedger(set.personId, "quiz_answer")).toBe(0);
  });

  it("R4.3-T1: a persona answer over 200 characters marks the quiz failed and stores nothing for that item", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ state: "answering", personaAnswers: { allExcept: 10 }, humanAnswers: "none", questionIdAt: { position: 10, questionId: 11 } });
    const quizId = quizIdOf(set);

    await answerQuizTask(JobPayloads.answer_quiz.parse({ quizId, personId: set.personId }), context);

    expect((await readQuiz(set.personId, quizId)).state).toBe("failed");
    expect(requireElement(await readItems(set.personId, quizId), 9).persona_answer).toBeNull();
    expect(await countLedger(set.personId, "quiz_answer")).toBe(1);
  });

  it("D58-T1: a full limiter window re-enqueues the answer job and changes nothing (uses the recording enqueue of makeTestJobContext, a fake)", async () => {
    const { context, enqueued } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ state: "answering", personaAnswers: "none", humanAnswers: "none" });
    const quizId = quizIdOf(set);
    const plantedId = await plantLedgerRow(set.personId, { estTokens: 3_000_000, status: "started" });
    try {
      await answerQuizTask(JobPayloads.answer_quiz.parse({ quizId, personId: set.personId }), context);

      expect((await readQuiz(set.personId, quizId)).state).toBe("answering");
      expect((await readItems(set.personId, quizId)).every((item) => item.persona_answer === null)).toBe(true);
      expect(await countLedger(set.personId, "quiz_answer")).toBe(1);
      expect(enqueued).toHaveLength(1);
      const [job] = enqueued;
      expect(job?.name).toBe("answer_quiz");
      expect(job?.payload).toEqual({ quizId, personId: set.personId });
      expect(job?.options?.runAt).toBeInstanceOf(Date);
    } finally {
      await removeLedgerRow(set.personId, plantedId);
    }
  });

  it("D60-T1: the daily dollar cap marks the quiz failed", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ state: "answering", personaAnswers: "none", humanAnswers: "none" });
    const quizId = quizIdOf(set);
    const plantedId = await plantLedgerRow(set.personId, { estTokens: 0, usd: context.env.DAILY_USD_CAP, status: "ok" });
    try {
      await answerQuizTask(JobPayloads.answer_quiz.parse({ quizId, personId: set.personId }), context);

      expect((await readQuiz(set.personId, quizId)).state).toBe("failed");
      expect((await readItems(set.personId, quizId)).every((item) => item.persona_answer === null)).toBe(true);
      expect(await countLedger(set.personId, "quiz_answer")).toBe(1);
    } finally {
      await removeLedgerRow(set.personId, plantedId);
    }
  });

  it("D29-T3: a second answer job on a quiz already waiting for the human makes no call", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ state: "waiting_human", personaAnswers: "all", humanAnswers: "none" });
    const quizId = quizIdOf(set);

    await answerQuizTask(JobPayloads.answer_quiz.parse({ quizId, personId: set.personId }), context);

    expect((await readQuiz(set.personId, quizId)).state).toBe("waiting_human");
    expect((await readItems(set.personId, quizId)).map((item) => item.persona_answer)).toEqual(FIXTURE_PERSONA_ANSWERS);
    expect(await countLedger(set.personId, "quiz_answer")).toBe(0);
  });

  it("R4.4-T1: a judge whose calibration passes judges the ten items once", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ quizId: FIXTURE_QUIZ_IDS.judgedFirstRun, state: "judging", personaAnswers: "all", humanAnswers: "all" });
    const quizId = quizIdOf(set);

    await judgeQuizTask(JobPayloads.judge_quiz.parse({ quizId, personId: set.personId }), context);

    const quiz = await readQuiz(set.personId, quizId);
    expect(quiz.state).toBe("judged");
    expect(quiz.matched).toBe(7);
    expect(quiz.reliable).toBe(true);
    expect(quiz.judge_runs).toBe(1);
    expect(quiz.judged_at).not.toBeNull();
    const items = await readItems(set.personId, quizId);
    expect(items.map((item) => item.agree)).toEqual(RUN_1_VERDICTS);
    expect(items.map((item) => item.judge_reason)).toEqual(items.map((item) => (item.agree === true ? AGREE_REASON : DISAGREE_REASON)));
    expect(await countLedger(set.personId, "quiz_judge")).toBe(12);
  });

  it("R4.5-T2: every judged item keeps its raw judge record and the quiz its calibration record", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ quizId: FIXTURE_QUIZ_IDS.rawRecord, state: "judging", personaAnswers: "all", humanAnswers: "all" });
    const quizId = quizIdOf(set);

    await judgeQuizTask(JobPayloads.judge_quiz.parse({ quizId, personId: set.personId }), context);

    const judgeRows = await withPerson(workerDb, set.personId, (trx) => trx.selectFrom("ledger").select(["id"]).where("person_id", "=", set.personId).where("call_site", "=", "quiz_judge").execute());
    const ledgerIds = new Set(judgeRows.map((row) => row.id));
    for (const item of await readItems(set.personId, quizId)) {
      const raw = QuizJudgeRaw.parse(item.judge_raw);
      const isAgree = requireElement(RUN_1_VERDICTS, item.position - 1);
      expect(raw.run).toBe(1);
      expect(raw.isHumanFirst).toBe(FIXTURE_FLIPPED_POSITIONS.has(item.position));
      expect(raw.output).toEqual({ agree: isAgree, reason: isAgree ? AGREE_REASON : DISAGREE_REASON });
      expect(ledgerIds.has(raw.ledgerId)).toBe(true);
    }
    const calibration = QuizCalibrationRaw.parse((await readQuiz(set.personId, quizId)).calibration_raw);
    expect(calibration).toHaveLength(1);
    const [run] = calibration;
    expect(run?.entryIndex).toBe(0);
    expect(run?.isPassed).toBe(true);
    expect(run?.pairs.every((pair) => pair.isPassed)).toBe(true);
  });

  it("R4.4-T2: a failed calibration reruns once with the other order and keeps the rerun's verdicts", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ quizId: FIXTURE_QUIZ_IDS.rerunPasses, state: "judging", personaAnswers: "all", humanAnswers: "all" });
    const quizId = quizIdOf(set);

    await judgeQuizTask(JobPayloads.judge_quiz.parse({ quizId, personId: set.personId }), context);

    const quiz = await readQuiz(set.personId, quizId);
    expect(quiz.state).toBe("judged");
    expect(quiz.judge_runs).toBe(2);
    expect(quiz.reliable).toBe(true);
    expect(quiz.matched).toBe(6);
    const items = await readItems(set.personId, quizId);
    expect(items.map((item) => item.agree)).toEqual(RUN_2_VERDICTS);
    for (const item of items) {
      const raw = QuizJudgeRaw.parse(item.judge_raw);
      expect(raw.run).toBe(2);
      expect(raw.isHumanFirst).toBe(!FIXTURE_FLIPPED_POSITIONS.has(item.position));
    }
    const [first, second] = QuizCalibrationRaw.parse(quiz.calibration_raw);
    expect(first?.entryIndex).toBe(2);
    expect(first?.isPassed).toBe(false);
    expect(requireElement(first?.pairs ?? [], 1).isPassed).toBe(false);
    expect(second?.entryIndex).toBe(3);
    expect(second?.isPassed).toBe(true);
    expect(await countLedger(set.personId, "quiz_judge")).toBe(14);
  });

  it("R4.6-T2: a judge that fails both calibrations marks the count unreliable", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ quizId: FIXTURE_QUIZ_IDS.failsTwice, state: "judging", personaAnswers: "all", humanAnswers: "all" });
    const quizId = quizIdOf(set);

    await judgeQuizTask(JobPayloads.judge_quiz.parse({ quizId, personId: set.personId }), context);

    const quiz = await readQuiz(set.personId, quizId);
    expect(quiz.state).toBe("judged");
    expect(quiz.reliable).toBe(false);
    expect(quiz.judge_runs).toBe(2);
    expect(quiz.matched).toBe(6);
    const [first, second] = QuizCalibrationRaw.parse(quiz.calibration_raw);
    expect(first?.entryIndex).toBe(4);
    expect(first?.isPassed).toBe(false);
    expect(requireElement(first?.pairs ?? [], 1).isPassed).toBe(false);
    expect(second?.entryIndex).toBe(5);
    expect(second?.isPassed).toBe(false);
    expect(requireElement(second?.pairs ?? [], 0).isPassed).toBe(false);
    expect(await countLedger(set.personId, "quiz_judge")).toBe(14);
  });

  it("R4.4-T3: an unreadable judge reply in the rerun marks the quiz failed and stores no verdict", async () => {
    const { context } = makeTestJobContext({ db: workerDb });
    const set = await setUpQuiz({ quizId: FIXTURE_QUIZ_IDS.unreadableSecondRun, state: "judging", personaAnswers: "all", humanAnswers: "all", humanAnswerAt6: FIXTURE_HUMAN_ANSWER_6_VARIANT });
    const quizId = quizIdOf(set);

    await judgeQuizTask(JobPayloads.judge_quiz.parse({ quizId, personId: set.personId }), context);

    const quiz = await readQuiz(set.personId, quizId);
    expect(quiz.state).toBe("failed");
    expect(quiz.matched).toBeNull();
    expect(quiz.reliable).toBeNull();
    expect(quiz.calibration_raw).toBeNull();
    expect(quiz.judge_runs).toBe(0);
    expect((await readItems(set.personId, quizId)).every((item) => item.agree === null)).toBe(true);
    expect(await countLedger(set.personId, "quiz_judge")).toBe(10);
  });

  it("D31-T5: quizMisses returns the missed question texts of a judged quiz in question id order", async () => {
    const set = await setUpQuiz({ state: "judged", personaAnswers: "all", humanAnswers: "all", verdicts: RUN_1_VERDICTS, reliable: true });

    const misses = await withPerson(workerDb, set.personId, (trx) => quizMisses(trx, set.cardId));

    expect(misses).toEqual([requireElement(QUIZ_BANK, 3).text, requireElement(QUIZ_BANK, 7).text, requireElement(QUIZ_BANK, 9).text]);
  });

  it("D31-T6: quizMisses returns an empty list when the judge was unreliable", async () => {
    const set = await setUpQuiz({ state: "judged", personaAnswers: "all", humanAnswers: "all", verdicts: RUN_1_VERDICTS, reliable: false });

    expect(await withPerson(workerDb, set.personId, (trx) => quizMisses(trx, set.cardId))).toEqual([]);
  });

  it("D31-T7: quizMisses returns an empty list for a card with no quiz", async () => {
    const set = await setUpQuiz({ withoutQuiz: true, state: "answering", personaAnswers: "none", humanAnswers: "none" });

    expect(await withPerson(workerDb, set.personId, (trx) => quizMisses(trx, set.cardId))).toEqual([]);
  });
});
