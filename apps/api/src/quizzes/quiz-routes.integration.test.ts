import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ErrorBody,
  QUIZ_BANK,
  QuizAnswersResponse,
  QuizRequestResponse,
  QuizView,
  SESSION_COOKIE,
  routes,
  sampleQuiz,
} from "@meet-first/contracts";
import { parseDatabaseError, withPerson } from "@meet-first/db";
import { createApprovedCard, createFrozenSource, createTestPerson } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { registerQuizRoutes } from "./index.js";

// The origin every request of this file carries: the test app's own address (the APP_ORIGIN of
// .env.example).
const TEST_ORIGIN = "http://localhost:3000";
// The six turns every owner's source holds, so a card has enough turns to quote.
const SIX_TURNS = [
  "route turn one",
  "route turn two",
  "route turn three",
  "route turn four",
  "route turn five",
  "route turn six",
];
// Which positions the stored verdicts mark as agreeing, as the judge fixtures give them.
const AGREE_BY_POSITION = [true, true, true, false, true, true, true, false, true, false];
// The body of every not_found answer.
const NOT_FOUND = { code: "not_found", message: "This no longer exists or is not yours." };
// The answers of the human, one per position.
const ANSWERS = {
  answers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((position) => ({
    position,
    text: `human answer ${String(position)}`,
  })),
};

let testApp: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  testApp = await buildTestApp({ routes: [registerQuizRoutes], env: { APP_ORIGIN: TEST_ORIGIN } });
});

afterAll(async () => {
  await testApp.close();
});

// A person and the session token that acts for them.
type Person = { personId: string; sessionToken: string };

// Returns the element at one place, or throws, so a test never reads past what it set up.
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no element at place ${String(index)}`);
  return value;
}

// Sends one request as the person, with the session cookie and the test origin.
async function send(
  person: Person,
  request: { method: "GET" | "POST"; url: string; payload?: object },
) {
  const headers = { cookie: `${SESSION_COOKIE}=${person.sessionToken}`, origin: TEST_ORIGIN };
  return testApp.app.inject({
    method: request.method,
    url: request.url,
    headers,
    ...(request.payload === undefined ? {} : { payload: request.payload }),
  });
}

// The paths of the three quiz routes, with the id filled in.
const requestQuizPath = (cardId: string): string =>
  routes.cards.requestQuiz.path.replace(":id", cardId);
const readQuizPath = (quizId: string): string => routes.cards.readQuiz.path.replace(":id", quizId);
const answerQuizPath = (quizId: string): string =>
  routes.cards.answerQuiz.path.replace(":id", quizId);

// One owner with a frozen source and an approved card of six items, for one test.
async function ownerWithCard(name = "Quiz Owner"): Promise<{ owner: Person; cardId: string }> {
  const person = await createTestPerson(testApp.db, name);
  const source = await createFrozenSource(testApp.db, person.personId, [...SIX_TURNS]);
  const card = await createApprovedCard(testApp.db, source.sourceId, { items: 6 });
  return {
    owner: { personId: person.personId, sessionToken: person.sessionToken },
    cardId: card.cardId,
  };
}

// Starts a quiz for the card as the owner and returns the quiz id from the reply.
async function startQuiz(owner: Person, cardId: string): Promise<string> {
  const response = await send(owner, { method: "POST", url: requestQuizPath(cardId) });
  return QuizRequestResponse.parse(response.json()).quizId;
}

// Writes the persona answers and opens the quiz for the human, as the answer job would after its
// last call.
async function fillPersonaAnswers(personId: string, quizId: string): Promise<void> {
  await withPerson(testApp.db, personId, async (trx) => {
    for (let position = 1; position <= 10; position += 1) {
      await trx
        .updateTable("quiz_items")
        .set({ persona_answer: `persona answer ${String(position)}` })
        .where("quiz_id", "=", quizId)
        .where("position", "=", position)
        .execute();
    }
    await trx
      .updateTable("quizzes")
      .set({ state: "waiting_human" })
      .where("id", "=", quizId)
      .execute();
  });
}

// Writes both answers and the verdicts on every item, as the judge job would, and marks the quiz
// judged.
async function setJudged(
  personId: string,
  quizId: string,
  result: { matched: number; reliable: boolean },
): Promise<void> {
  await withPerson(testApp.db, personId, async (trx) => {
    for (let position = 1; position <= 10; position += 1) {
      const isAgree = at(AGREE_BY_POSITION, position - 1);
      await trx
        .updateTable("quiz_items")
        .set({
          persona_answer: `persona answer ${String(position)}`,
          human_answer: `human answer ${String(position)}`,
          agree: isAgree,
        })
        .where("quiz_id", "=", quizId)
        .where("position", "=", position)
        .execute();
    }
    await trx
      .updateTable("quizzes")
      .set({
        state: "judged",
        matched: result.matched,
        reliable: result.reliable,
        judge_runs: 1,
        judged_at: new Date(),
      })
      .where("id", "=", quizId)
      .execute();
  });
}

// The items of a quiz in position order, read as the owner.
async function readItems(personId: string, quizId: string) {
  return withPerson(testApp.db, personId, (trx) =>
    trx
      .selectFrom("quiz_items")
      .selectAll()
      .where("quiz_id", "=", quizId)
      .orderBy("position", "asc")
      .execute(),
  );
}

// The number of quiz rows for a card, read as the given person.
async function countQuizzes(personId: string, cardId: string): Promise<number> {
  const rows = await withPerson(testApp.db, personId, (trx) =>
    trx.selectFrom("quizzes").select(["id"]).where("card_id", "=", cardId).execute(),
  );
  return rows.length;
}

describe("quiz routes", () => {
  it("D28-T2: starting a quiz makes one quiz row and ten items sampled by the card id", async () => {
    const { owner, cardId } = await ownerWithCard();

    const response = await send(owner, { method: "POST", url: requestQuizPath(cardId) });

    expect(response.statusCode).toBe(202);
    const body = QuizRequestResponse.parse(response.json());
    const quizzes = await withPerson(testApp.db, owner.personId, (trx) =>
      trx.selectFrom("quizzes").selectAll().where("card_id", "=", cardId).execute(),
    );
    expect(quizzes).toHaveLength(1);
    const quiz = at(quizzes, 0);
    expect(quiz.id).toBe(body.quizId);
    expect(quiz.bank_version).toBe(1);
    expect(quiz.seed).toBe(cardId);
    expect(quiz.state).toBe("answering");
    expect(quiz.person_id).toBe(owner.personId);
    const items = await readItems(owner.personId, body.quizId);
    expect(items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(items.map((item) => item.question_id)).toEqual(sampleQuiz(cardId));
    for (const item of items) {
      expect(item.bank_version).toBe(1);
      expect(item.persona_answer).toBeNull();
      expect(item.human_answer).toBeNull();
      expect(item.agree).toBeNull();
      expect(typeof item.flipped).toBe("boolean");
    }
  });

  it("D28-T3: a card that is built and not yet approved can start a quiz", async () => {
    const { owner, cardId } = await ownerWithCard();
    await withPerson(testApp.db, owner.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ state: "ready", approved_at: null })
        .where("id", "=", cardId)
        .execute(),
    );

    const response = await send(owner, { method: "POST", url: requestQuizPath(cardId) });

    expect(response.statusCode).toBe(202);
    expect(await countQuizzes(owner.personId, cardId)).toBe(1);
  });

  it("D23-T1: a thin card skips the quiz", async () => {
    const { owner, cardId } = await ownerWithCard();
    await withPerson(testApp.db, owner.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ thin: true, state: "thin" })
        .where("id", "=", cardId)
        .execute(),
    );

    const response = await send(owner, { method: "POST", url: requestQuizPath(cardId) });

    expect(response.statusCode).toBe(409);
    expect(ErrorBody.parse(response.json())).toEqual({
      code: "card_thin",
      message:
        "This card has fewer than 6 verified items, so the quiz is skipped. You can still meet.",
    });
    expect(await countQuizzes(owner.personId, cardId)).toBe(0);
  });

  it("D28-T4: a card still building cannot start a quiz", async () => {
    const { owner, cardId } = await ownerWithCard();
    await withPerson(testApp.db, owner.personId, (trx) =>
      trx.updateTable("cards").set({ state: "building" }).where("id", "=", cardId).execute(),
    );

    const response = await send(owner, { method: "POST", url: requestQuizPath(cardId) });

    expect(response.statusCode).toBe(409);
    expect(ErrorBody.parse(response.json())).toEqual({
      code: "card_not_ready",
      message: "The card is still being built or failed. Wait for it to be ready, then try again.",
    });
    expect(await countQuizzes(owner.personId, cardId)).toBe(0);
  });

  it("D28-T5: a card holds one quiz", async () => {
    const { owner, cardId } = await ownerWithCard();
    await send(owner, { method: "POST", url: requestQuizPath(cardId) });

    const second = await send(owner, { method: "POST", url: requestQuizPath(cardId) });

    expect(second.statusCode).toBe(409);
    expect(ErrorBody.parse(second.json())).toEqual({
      code: "quiz_exists",
      message: "This card already has a quiz. Open it instead of starting another.",
    });
    expect(await countQuizzes(owner.personId, cardId)).toBe(1);
  });

  it("D55-T1: another person's card answers not found", async () => {
    const { owner } = await ownerWithCard("Quiz Owner");
    const other = await ownerWithCard("Other Person");

    const response = await send(owner, { method: "POST", url: requestQuizPath(other.cardId) });

    expect(response.statusCode).toBe(404);
    expect(ErrorBody.parse(response.json())).toEqual(NOT_FOUND);
    expect(await countQuizzes(other.owner.personId, other.cardId)).toBe(0);
  });

  it("D28-T6: a malformed card id answers not found", async () => {
    const { owner } = await ownerWithCard();

    const response = await send(owner, { method: "POST", url: requestQuizPath("not-a-uuid") });

    expect(response.statusCode).toBe(404);
    expect(ErrorBody.parse(response.json())).toEqual(NOT_FOUND);
  });

  it("R4.7-T1: every item names a question of bank version 1", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);

    const response = await send(owner, { method: "GET", url: readQuizPath(quizId) });

    expect(response.statusCode).toBe(200);
    for (const item of QuizView.parse(response.json()).items) {
      expect(item.questionText).toBe(at(QUIZ_BANK, item.questionId - 1).text);
    }
    expect((await readItems(owner.personId, quizId)).every((item) => item.bank_version === 1)).toBe(
      true,
    );
  });

  it("R4.2-T1: the persona answers stay hidden until the human has answered", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await fillPersonaAnswers(owner.personId, quizId);

    const response = await send(owner, { method: "GET", url: readQuizPath(quizId) });

    expect(response.statusCode).toBe(200);
    const view = QuizView.parse(response.json());
    expect(view.state).toBe("waiting_human");
    for (const item of view.items) {
      expect(Object.keys(item)).not.toContain("personaAnswer");
      expect(Object.keys(item)).not.toContain("humanAnswer");
    }
    for (let position = 1; position <= 10; position += 1) {
      expect(response.body).not.toContain(`persona answer ${String(position)}`);
    }
    expect(view.copy).toBe("");
  });

  it("R4.2-T2: sending the ten answers stores them and then shows both answers", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await fillPersonaAnswers(owner.personId, quizId);

    const sent = await send(owner, {
      method: "POST",
      url: answerQuizPath(quizId),
      payload: ANSWERS,
    });

    expect(sent.statusCode).toBe(202);
    expect(QuizAnswersResponse.parse(sent.json())).toEqual({ state: "judging" });
    for (const item of await readItems(owner.personId, quizId)) {
      expect(item.human_answer).toBe(`human answer ${String(item.position)}`);
      expect(item.answered_at).not.toBeNull();
    }
    const quiz = await withPerson(testApp.db, owner.personId, (trx) =>
      trx
        .selectFrom("quizzes")
        .select(["state"])
        .where("id", "=", quizId)
        .executeTakeFirstOrThrow(),
    );
    expect(quiz.state).toBe("judging");
    const view = QuizView.parse(
      (await send(owner, { method: "GET", url: readQuizPath(quizId) })).json(),
    );
    for (const item of view.items) {
      expect(item.personaAnswer).toBe(`persona answer ${String(item.position)}`);
      expect(item.humanAnswer).toBe(`human answer ${String(item.position)}`);
      expect(Object.keys(item)).not.toContain("agree");
    }
    expect(view.copy).toBe("");
  });

  it("R4.2-T3: a second send of the answers is refused", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await fillPersonaAnswers(owner.personId, quizId);
    await send(owner, { method: "POST", url: answerQuizPath(quizId), payload: ANSWERS });
    const before = await readItems(owner.personId, quizId);

    const again = await send(owner, {
      method: "POST",
      url: answerQuizPath(quizId),
      payload: ANSWERS,
    });

    expect(again.statusCode).toBe(409);
    expect(ErrorBody.parse(again.json())).toEqual({
      code: "quiz_not_waiting",
      message:
        "This quiz is not ready for your answers, or you already sent them. Reload to see where it stands.",
    });
    expect(await readItems(owner.personId, quizId)).toEqual(before);
  });

  it("D29-T1: answers sent before the persona has answered are refused", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);

    const response = await send(owner, {
      method: "POST",
      url: answerQuizPath(quizId),
      payload: ANSWERS,
    });

    expect(response.statusCode).toBe(409);
    expect(ErrorBody.parse(response.json()).code).toBe("quiz_not_waiting");
    expect(
      (await readItems(owner.personId, quizId)).every((item) => item.human_answer === null),
    ).toBe(true);
  });

  it("D29-T2: each position must be answered exactly once", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await fillPersonaAnswers(owner.personId, quizId);
    const duplicated = {
      answers: [...ANSWERS.answers.slice(0, 9), { position: 1, text: "human answer 1" }],
    };

    const response = await send(owner, {
      method: "POST",
      url: answerQuizPath(quizId),
      payload: duplicated,
    });

    expect(response.statusCode).toBe(409);
    expect(ErrorBody.parse(response.json())).toEqual({
      code: "quiz_answers_incomplete",
      message: "All 10 answers are needed and each position once. Check the form and send again.",
    });
    expect(
      (await readItems(owner.personId, quizId)).every((item) => item.human_answer === null),
    ).toBe(true);
    const quiz = await withPerson(testApp.db, owner.personId, (trx) =>
      trx
        .selectFrom("quizzes")
        .select(["state"])
        .where("id", "=", quizId)
        .executeTakeFirstOrThrow(),
    );
    expect(quiz.state).toBe("waiting_human");
  });

  it("INV7-T1: the database refuses a human answer while the persona answer is missing", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await withPerson(testApp.db, owner.personId, (trx) =>
      trx
        .updateTable("quiz_items")
        .set({ persona_answer: "persona answer 2" })
        .where("quiz_id", "=", quizId)
        .where("position", "=", 2)
        .execute(),
    );
    const act = () =>
      withPerson(testApp.db, owner.personId, (trx) =>
        trx
          .updateTable("quiz_items")
          .set({ human_answer: "x" })
          .where("quiz_id", "=", quizId)
          .where("position", "=", 1)
          .execute(),
      );

    const error: unknown = await act().then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeDefined();
    expect(parseDatabaseError(error)).toEqual({
      code: "persona_answer_missing",
      message: "Your Meety has not answered this question yet. Wait a moment and reload.",
    });
    const second = await withPerson(testApp.db, owner.personId, (trx) =>
      trx
        .updateTable("quiz_items")
        .set({ human_answer: "x" })
        .where("quiz_id", "=", quizId)
        .where("position", "=", 2)
        .execute(),
    );
    expect(Number(at(second, 0).numUpdatedRows)).toBe(1);
    expect(at(await readItems(owner.personId, quizId), 0).human_answer).toBeNull();
  });

  it("R4.3-T2: an answer over 200 characters is refused", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await fillPersonaAnswers(owner.personId, quizId);
    const tooLong = {
      answers: ANSWERS.answers.map((answer) =>
        answer.position === 1 ? { position: 1, text: "a".repeat(201) } : answer,
      ),
    };

    const response = await send(owner, {
      method: "POST",
      url: answerQuizPath(quizId),
      payload: tooLong,
    });

    expect(response.statusCode).toBe(400);
    expect(ErrorBody.parse(response.json())).toEqual({
      code: "payload_invalid",
      message: "The request body did not match the expected shape. Reload and try again.",
    });
    expect(
      (await readItems(owner.personId, quizId)).every((item) => item.human_answer === null),
    ).toBe(true);
  });

  it("R4.3-T3: nine answers are refused", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await fillPersonaAnswers(owner.personId, quizId);

    const response = await send(owner, {
      method: "POST",
      url: answerQuizPath(quizId),
      payload: { answers: ANSWERS.answers.slice(0, 9) },
    });

    expect(response.statusCode).toBe(400);
    expect(ErrorBody.parse(response.json()).code).toBe("payload_invalid");
    expect(
      (await readItems(owner.personId, quizId)).every((item) => item.human_answer === null),
    ).toBe(true);
  });

  it("D31-T8: a judged quiz reads matched n of 10", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await setJudged(owner.personId, quizId, { matched: 7, reliable: true });

    const view = QuizView.parse(
      (await send(owner, { method: "GET", url: readQuizPath(quizId) })).json(),
    );

    expect(view.copy).toBe("matched 7 of 10");
    expect(view.matched).toBe(7);
    expect(view.reliable).toBe(true);
    view.items.forEach((item, index) => {
      expect(typeof item.agree).toBe("boolean");
      expect(item.personaAnswer).toBeDefined();
      expect(item.humanAnswer).toBeDefined();
      expect(item.agree).toBe(at(AGREE_BY_POSITION, index));
    });
    expect(view.items.filter((item) => item.agree === false).map((item) => item.position)).toEqual([
      4, 8, 10,
    ]);
  });

  it("D31-T9: an unreliable judged quiz says its count is rough", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await setJudged(owner.personId, quizId, { matched: 6, reliable: false });

    const view = QuizView.parse(
      (await send(owner, { method: "GET", url: readQuizPath(quizId) })).json(),
    );

    expect(view.copy).toBe("matched 6 of 10. This count may be a little off.");
    expect(view.reliable).toBe(false);
  });

  it("R4.5-T3: no quiz response carries a percentage", async () => {
    const { owner, cardId } = await ownerWithCard();
    const quizId = await startQuiz(owner, cardId);
    await setJudged(owner.personId, quizId, { matched: 7, reliable: true });

    const response = await send(owner, { method: "GET", url: readQuizPath(quizId) });

    expect(response.body).not.toMatch(/%/);
    expect(response.body).not.toMatch(/percent/i);
  });
});
