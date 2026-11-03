// Steps 5 to 7: A's quiz, both people's approvals with the recall switch, and the pair with its meeting, started by both go-aheads.
import { ErrorBody, MEETING_LENGTH_MINUTES, PAIR_LIFETIME_HOURS, QuizView, QUIZ_ITEMS, RECALL_SWITCH_COPY, routes } from "@meet-first/contracts";
import { countApprovedItems, countRecallCorpus, countSteps, readCard, readMeeting, readMembers, readQuestionRejection, readQuiz } from "./database-reads.js";
import { EventStreamReader } from "./event-stream-reader.js";
import type { PersonClient } from "./person-client.js";
import { FREE_TEXT_QUESTION, PLANNED_DISCONNECT_SEQ, QUESTION_ID } from "./fixtures.js";
import { check, finishStep, need, pollUntil, routePath, type Assertion, type RunState, type StepResult } from "./report.js";
import { readCardView } from "./steps-people-and-sources.js";

// The quiz may take 120 s to reach the human, and 120 s more to judge (the spec's limits).
const QUIZ_TIMEOUT_MS = 120_000;
const QUIZ_POLL_MS = 3_000;
// The question check may take 45 s (the call's timeout is 30 s, ARCHITECTURE 8).
const QUESTION_CHECK_TIMEOUT_MS = 45_000;
// The meeting may take 75 s to start once both have said ready (the spec's limit).
const START_TIMEOUT_MS = 75_000;
const START_POLL_MS = 1_000;
// The window a start may be off by: 2 s of the ten minutes.
const LENGTH_TOLERANCE_MS = 2_000;
// The meeting screen waits this long for the reader to see its first event.
const FIRST_EVENT_TIMEOUT_MS = 10_000;
// The words of the quiz count line: a number of matches and "of 10", never a percentage.
const COUNT_LINE = /^matched (10|[0-9]) of 10/;

// Reads one quiz with its ten questions.
export async function readQuizView(client: PersonClient, quizId: string) {
  const reply = await client.json({ method: "GET", path: routePath(routes.cards.readQuiz.path, { id: quizId }), expect: 200, schema: routes.cards.readQuiz.response });
  return reply.body;
}

// Reads one meeting as the person who asks for it (MeetingView).
export async function readMeetingView(client: PersonClient, meetingId: string) {
  const reply = await client.json({ method: "GET", path: routePath(routes.meetings.readMeeting.path, { id: meetingId }), expect: 200, schema: routes.meetings.readMeeting.response });
  return reply.body;
}

// The checks on one judged quiz: ten items, the answers and judgments on each, and the count line. A count of "%" is refused.
function judgedChecks(view: QuizView): Assertion[] {
  const isJudged = view.items.every((item) => item.personaAnswer !== undefined && item.humanAnswer !== undefined && typeof item.agree === "boolean");
  return [
    check("the quiz is judged", "judged", view.state),
    check("matched is a whole number from 0 to 10", true, Number.isInteger(view.matched) && (view.matched ?? -1) >= 0 && (view.matched ?? 11) <= QUIZ_ITEMS),
    check("the copy reads matched n of 10", true, COUNT_LINE.test(view.copy)),
    check("the copy has no percentage", false, view.copy.includes("%")),
    check("every question has a persona answer, a human answer and a judgment", true, isJudged),
  ];
}

// Step 5: A takes the quiz. Under --mock the whole step is not exercised, because a judged quiz cannot be replayed. Under --record it is
// skipped too: the quiz's misses go into A's meeting prompt, so a recording made with them would not replay under --mock.
export async function step05Quiz(run: RunState): Promise<StepResult> {
  if (run.options.mode === "mock") {
    return finishStep(5, "quiz", { rows: ["R4.2", "R4.5", "D31"], detail: "not exercised under --mock: a judged quiz cannot be replayed", assertions: [], notExercised: true });
  }
  if (run.options.mode === "record") {
    return finishStep(5, "quiz", { rows: ["R4.2", "R4.5", "D31"], detail: "not exercised under --record: the recording follows the --mock path, which has no quiz", assertions: [], notExercised: true });
  }
  const personA = need(run.ids.personA, "personA");
  const cardId = need(run.ids.cardA, "cardA");
  const requested = await run.a.json({ method: "POST", path: routePath(routes.cards.requestQuiz.path, { id: cardId }), expect: 202, schema: routes.cards.requestQuiz.response });
  const quizId = requested.body.quizId;
  run.ids.quizA = quizId;
  const waiting = await pollUntil(() => readQuizView(run.a, quizId), (view) => view.state === "waiting_human", { timeoutMs: QUIZ_TIMEOUT_MS, intervalMs: QUIZ_POLL_MS });
  const assertions: Assertion[] = [
    check("the quiz has ten items", QUIZ_ITEMS, waiting.items.length),
    check("every question id is in the bank", true, waiting.items.every((item) => item.questionId >= 1 && item.questionId <= 30)),
    check("every question has text", true, waiting.items.every((item) => item.questionText !== "")),
    check("no persona answer is shown before the human answers", true, waiting.items.every((item) => item.personaAnswer === undefined)),
  ];
  const answers = waiting.items.map((item) => ({ position: item.position, text: `golden path answer ${String(item.position)}` }));
  await run.a.json({ method: "POST", path: routePath(routes.cards.answerQuiz.path, { id: quizId }), body: { answers }, expect: 202, schema: routes.cards.answerQuiz.response });
  const judged = await pollUntil(() => readQuizView(run.a, quizId), (view) => view.state === "judged" || view.state === "failed", { timeoutMs: QUIZ_TIMEOUT_MS, intervalMs: QUIZ_POLL_MS });
  assertions.push(...judgedChecks(judged));
  const row = await readQuiz(run.db, personA, quizId);
  assertions.push(check("the database says judged", "judged", row.state), check("the judge ran once or twice", true, row.judge_runs >= 1 && row.judge_runs <= 2));
  return finishStep(5, "quiz", { rows: ["R4.2", "R4.5", "D31"], detail: `quizA ${judged.state}; copy "${judged.copy.slice(0, 40)}"`, assertions });
}

// Step 6: both people approve their items. A turns the recall switch on, B leaves it off, and B's recall corpus stays empty.
export async function step06Approve(run: RunState): Promise<StepResult> {
  const personA = need(run.ids.personA, "personA");
  const personB = need(run.ids.personB, "personB");
  const cardA = need(run.ids.cardA, "cardA");
  const cardB = need(run.ids.cardB, "cardB");
  const viewA = await readCardView(run.a, cardA);
  const itemIdsA = viewA.items.filter((item) => item.verified).map((item) => item.id);
  const approvedA = await run.a.json({ method: "POST", path: routePath(routes.cards.approveCard.path, { id: cardA }), body: { itemIds: itemIdsA, recallAllowed: true }, expect: 200, schema: routes.cards.approveCard.response });
  const viewB = await readCardView(run.b, cardB);
  const itemIdsB = viewB.items.filter((item) => item.verified).map((item) => item.id);
  const approvedB = await run.b.json({ method: "POST", path: routePath(routes.cards.approveCard.path, { id: cardB }), body: { itemIds: itemIdsB, recallAllowed: false }, expect: 200, schema: routes.cards.approveCard.response });
  const cardRowA = await readCard(run.db, personA, cardA);
  const cardRowB = await readCard(run.db, personB, cardB);
  const assertions: Assertion[] = [
    check("A's approval is approved", "approved", approvedA.body.state),
    check("B's approval is approved", "approved", approvedB.body.state),
    check("A has the recall switch on", true, cardRowA.recall_allowed),
    check("B has the recall switch off", false, cardRowB.recall_allowed),
    check("every item of A is approved", viewA.items.length, await countApprovedItems(run.db, personA, cardA)),
    check("B's recall corpus is empty", 0, await countRecallCorpus(run.db, personB, cardB)),
    check("A's recall corpus has at least one turn", true, (await countRecallCorpus(run.db, personA, cardA)) >= 1),
  ];
  run.manual.push(`the switch copy reads "${RECALL_SWITCH_COPY}" and is off by default (R7.1)`);
  return finishStep(6, "approve", { rows: ["R7.1", "invariant 16"], detail: `recallA on, recallB off, corpusB ${String(await countRecallCorpus(run.db, personB, cardB))}`, assertions });
}

// Step 7: A creates the pair, B joins with the token from the link, both ask a question, and both say ready. The meeting then starts by itself.
export async function step07Pair(run: RunState): Promise<StepResult> {
  const cardA = need(run.ids.cardA, "cardA");
  const created = await run.a.json({ method: "POST", path: routes.meetings.createPair.path, expect: 201, schema: routes.meetings.createPair.response });
  const pairId = created.body.pairId;
  run.ids.pairId = pairId;
  const token = new URL(created.body.inviteUrl).hash.slice(1);
  const assertions: Assertion[] = [check("the invite expires within 24 hours and a minute", true, Date.parse(created.body.expiresAt) - Date.now() <= PAIR_LIFETIME_HOURS * 3_600_000 + 60_000)];
  const joined = await run.b.json({ method: "POST", path: routes.meetings.joinPair.path, body: { token }, expect: 200, schema: routes.meetings.joinPair.response });
  await run.b.json({ method: "POST", path: routes.meetings.joinPair.path, body: { token }, expect: 409, schema: ErrorBody });
  await run.a.json({ method: "POST", path: routes.meetings.joinPair.path, body: { token }, expect: 409, schema: ErrorBody });
  assertions.push(check("B joins the pair", pairId, joined.body.pairId));
  const createPath = routePath(routes.meetings.createMeeting.path, { id: pairId });
  const meeting = await run.a.json({ method: "POST", path: createPath, body: { questionId: QUESTION_ID, cardId: cardA }, expect: 201, schema: routes.meetings.createMeeting.response });
  const meetingId = meeting.body.meetingId;
  run.ids.meetingId = meetingId;
  assertions.push(...(await askFreeTextQuestion(run, { createPath, cardId: cardA })));
  const view = await readMeetingView(run.a, meetingId);
  assertions.push(
    check("the meeting is ready", "ready", view.state),
    check("the question is checked", true, view.questionChecked),
    check("two members are listed", 2, view.members.length),
    check("side a is A", "A", view.members.find((member) => member.side === "a")?.displayName),
    check("side b is B", "B", view.members.find((member) => member.side === "b")?.displayName),
    check("A is viewing as side a", "a", view.viewerSide),
  );
  await startRefusals(run, meetingId);
  const running = await pollUntil(() => readMeetingView(run.a, meetingId), (value) => value.state !== "ready", { timeoutMs: START_TIMEOUT_MS, intervalMs: START_POLL_MS });
  assertions.push(check("the meeting starts by itself after both go-aheads", "running", running.state));
  await run.a.json({ method: "POST", path: routePath(routes.meetings.start.path, { id: meetingId }), expect: 409, schema: ErrorBody });
  await checkStartedRows(run, meetingId, assertions);
  await openReaders(run, meetingId, assertions);
  run.manual.push("B joins by scanning the QR with the phone camera (D32)");
  const detail = running.state === "queued" ? "meeting_queued: 40 meetings are running; the gate needs an idle system" : `meetingId ${running.state}, both go-aheads given`;
  return finishStep(7, "pair", { rows: ["R5.3", "R9.3"], detail, assertions });
}

// Asks the free-text question in a second meeting that is never readied or started, and checks that the question check allows it.
async function askFreeTextQuestion(run: RunState, call: { createPath: string; cardId: string }): Promise<Assertion[]> {
  const second = await run.a.json({ method: "POST", path: call.createPath, body: { freeText: FREE_TEXT_QUESTION, cardId: call.cardId }, expect: 201, schema: routes.meetings.createMeeting.response });
  run.ids.secondMeetingId = second.body.meetingId;
  const checked = await pollUntil(() => readMeetingView(run.a, second.body.meetingId), (value) => value.questionChecked, { timeoutMs: QUESTION_CHECK_TIMEOUT_MS, intervalMs: QUIZ_POLL_MS });
  const rejection = await readQuestionRejection(run.db, second.body.meetingId);
  return [check("the free-text question is checked", true, checked.questionChecked), check("the question check allows the free text", true, rejection === null)];
}

// A start before both go-aheads is refused, and so is a start after only A's go-ahead.
async function startRefusals(run: RunState, meetingId: string): Promise<void> {
  const startPath = routePath(routes.meetings.start.path, { id: meetingId });
  const readyPath = routePath(routes.meetings.ready.path, { id: meetingId });
  await run.a.json({ method: "POST", path: startPath, expect: 409, schema: ErrorBody });
  await run.a.json({ method: "POST", path: readyPath, expect: 200, schema: routes.meetings.ready.response });
  await run.a.json({ method: "POST", path: startPath, expect: 409, schema: ErrorBody });
  await run.b.json({ method: "POST", path: readyPath, expect: 200, schema: routes.meetings.ready.response });
}

// The database rows of a started meeting: state, times, one step, and a stored prompt prefix for both members.
async function checkStartedRows(run: RunState, meetingId: string, assertions: Assertion[]): Promise<void> {
  const row = await readMeeting(run.db, meetingId);
  const span = row.ends_at !== null && row.started_at !== null ? row.ends_at.getTime() - row.started_at.getTime() : 0;
  const steps = await countSteps(run.db, meetingId);
  const members = await readMembers(run.db, meetingId);
  assertions.push(
    check("the database says running", "running", row.state),
    check("started_at is set", true, row.started_at !== null),
    check("the meeting lasts ten minutes", true, Math.abs(span - MEETING_LENGTH_MINUTES * 60_000) <= LENGTH_TOLERANCE_MS),
    check("one step exists", { count: 1, max: 1 }, steps),
    check("both members have a stored prefix", [true, true], members.map((member) => member.hasPrefix)),
  );
}

// Opens both readers. Reader A is cut at PLANNED_DISCONNECT_SEQ on purpose. Both must see meeting.started as the first event with seq 1.
async function openReaders(run: RunState, meetingId: string, assertions: Assertion[]): Promise<void> {
  run.readerA = new EventStreamReader(run.a, meetingId, { plannedDisconnectAtSeq: PLANNED_DISCONNECT_SEQ });
  run.readerB = new EventStreamReader(run.b, meetingId);
  await run.readerA.open();
  await run.readerB.open();
  await run.readerA.waitFor((event) => event.type === "meeting.started", FIRST_EVENT_TIMEOUT_MS);
  await run.readerB.waitFor((event) => event.type === "meeting.started", FIRST_EVENT_TIMEOUT_MS);
  for (const reader of [run.readerA, run.readerB]) {
    const first = reader.committed[0];
    assertions.push(check("the first event is meeting.started with seq 1", true, first?.type === "meeting.started" && first.seq === 1 && first.members.length === 2));
  }
}
