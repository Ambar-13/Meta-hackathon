import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ContractError, QUIZ_BANK } from "@meet-first/contracts";
import { buildChatRequest } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import { CALIBRATION_BANK } from "./calibration.js";
import { buildJudgeCall, buildPersonaAnswerCall, orderForJudge, requireElement, type PersonaCardItem, type QuizModelCall, type QuizPrompt } from "./quiz-requests.js";

// The six turns of the fixture source. Each fixture card item quotes one of them, in the same order.
export const FIXTURE_TURNS: readonly string[] = [
  "Tell me the bad news straight away, I can handle it. Waiting makes it worse.",
  "When a plan dies I sit down that evening and write a new one, every time.",
  "After dinner my phone is off for work, full stop. My evenings are for my family.",
  "I can spend a whole Saturday building a little tool and not notice the time.",
  "I want people to say my stuff still works years later, that is the whole point.",
  "I like a rough plan for the week but I hate when every hour is booked.",
];

// The six card items the job tests write over the items createApprovedCard made, positions 1 to 6.
export const FIXTURE_CARD_ITEMS: readonly PersonaCardItem[] = [
  { position: 1, kind: "value", claim: "Wants problems raised early and plainly", gloss: "Wants problems raised early and plainly", quote: "tell me the bad news straight away, I can handle it" },
  { position: 2, kind: "habit", claim: "Writes a fresh plan the same day a plan fails", gloss: "Writes a fresh plan the same day a plan fails", quote: "when a plan dies I sit down that evening and write a new one" },
  { position: 3, kind: "boundary", claim: "Does not answer work messages after dinner", gloss: "Does not answer work messages after dinner", quote: "after dinner my phone is off for work, full stop" },
  { position: 4, kind: "preference", claim: "Loses track of time building small tools", gloss: "Loses track of time building small tools", quote: "I can spend a whole Saturday building a little tool and not notice the time" },
  { position: 5, kind: "goal", claim: "Wants to be known for work that lasts", gloss: "Wants to be known for work that lasts", quote: "I want people to say my stuff still works years later" },
  { position: 6, kind: "preference", claim: "Prefers a loose weekly plan with room to move", gloss: "Prefers a loose weekly plan with room to move", quote: "I like a rough plan for the week but I hate when every hour is booked" },
];

// The bank question ids of every fixture quiz, positions 1 to 10 (D28 ids, fixed here so fixtures can match).
export const FIXTURE_QUESTION_IDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// The persona answers to questions 1 to 10 from the six-item card.
export const FIXTURE_PERSONA_ANSWERS: readonly string[] = [
  "I write a new plan the same evening.",
  "Straight away and plainly, I can handle it.",
  "Building small tools, I can lose a whole Saturday to it.",
  "My card does not say.",
  "I pick the one that will still work years from now.",
  "I don't answer work messages after dinner.",
  "A rough plan with room to move, not every hour booked.",
  "My card does not say.",
  "I raise it early and plainly.",
  "My card does not say.",
];

// The human answers the judge tests store, positions 1 to 10.
export const FIXTURE_HUMAN_ANSWERS: readonly string[] = [
  "I sulk for an hour, then make a new plan.",
  "Tell me right away, no padding.",
  "Coding little tools on weekends.",
  "I ask them what got in the way.",
  "The one that will hold up longest.",
  "No work messages after dinner.",
  "Room to move, a loose plan at most.",
  "They have to show me their past work.",
  "I tell them directly, in private.",
  "I go for a long walk.",
];

// The other human answer at position 6 that the unreadable-reply test stores.
export const FIXTURE_HUMAN_ANSWER_6_VARIANT = "Nothing after dinner, ever.";

// Positions whose flipped flag is true, so run 1 shows the human answer first there (D30).
export const FIXTURE_FLIPPED_POSITIONS: ReadonlySet<number> = new Set([2, 4, 6, 8, 10]);

// The verdicts the item fixtures return in run 1 (7 agree), positions 1 to 10.
export const RUN_1_VERDICTS: readonly boolean[] = [true, true, true, false, true, true, true, false, true, false];
// The verdicts the item fixtures return in run 2 (6 agree), positions 1 to 10.
export const RUN_2_VERDICTS: readonly boolean[] = [true, true, true, false, true, true, true, false, false, false];

// The reasons every judge fixture returns, by verdict.
export const AGREE_REASON = "Both answers give the same main point.";
// The reason every judge fixture returns for a disagreeing verdict.
export const DISAGREE_REASON = "The two answers give different main points.";

// The quiz ids of the judge tests. Their first two hex characters pick the calibration entries (calibration.ts).
export const FIXTURE_QUIZ_IDS = {
  judgedFirstRun: "00000000-0000-4000-8000-000000000101",
  rerunPasses: "02000000-0000-4000-8000-000000000102",
  failsTwice: "04000000-0000-4000-8000-000000000103",
  unreadableSecondRun: "0a000000-0000-4000-8000-000000000104",
  rawRecord: "08000000-0000-4000-8000-000000000105",
} as const;

// One fixture: its id, the call site, the call it answers, and the JSON content of the model's reply.
export type FixtureCase = { id: string; callSite: "quiz_answer" | "quiz_judge"; call: (prompt: QuizPrompt) => QuizModelCall; content: Record<string, unknown> };

// The answer and the judge fixture data shared by the cases below.
const AGREE = { agree: true, reason: AGREE_REASON };
const DISAGREE = { agree: false, reason: DISAGREE_REASON };

// The item of table B at one position, as the judge sees it.
function itemAt(position: number): { personaAnswer: string; humanAnswer: string; flipped: boolean } {
  return {
    personaAnswer: requireElement(FIXTURE_PERSONA_ANSWERS, position - 1),
    humanAnswer: requireElement(FIXTURE_HUMAN_ANSWERS, position - 1),
    flipped: FIXTURE_FLIPPED_POSITIONS.has(position),
  };
}

// The persona cases pa-01 to pa-12 (4.19).
function personaCases(): FixtureCase[] {
  const cases: FixtureCase[] = [];
  for (let question = 1; question <= 10; question += 1) {
    const position = question;
    cases.push({
      id: `pa-${String(question).padStart(2, "0")}`,
      callSite: "quiz_answer",
      call: (prompt) => buildPersonaAnswerCall(prompt, FIXTURE_CARD_ITEMS, requireElement(QUIZ_BANK, question - 1).text),
      content: { answer: requireElement(FIXTURE_PERSONA_ANSWERS, position - 1) },
    });
  }
  cases.push({
    id: "pa-11",
    callSite: "quiz_answer",
    call: (prompt) => buildPersonaAnswerCall(prompt, FIXTURE_CARD_ITEMS.slice(0, 5), requireElement(QUIZ_BANK, 6).text),
    content: { answer: "My card does not say." },
  });
  cases.push({
    id: "pa-12",
    callSite: "quiz_answer",
    call: (prompt) => buildPersonaAnswerCall(prompt, FIXTURE_CARD_ITEMS, requireElement(QUIZ_BANK, 10).text),
    content: { answer: "x".repeat(201) },
  });
  return cases;
}

// The calibration cases jc-<entry>-identical and jc-<entry>-contradicting (4.20).
function calibrationCases(): FixtureCase[] {
  const cases: FixtureCase[] = [];
  const expected: Array<{ entry: number; identical: boolean; contradicting: boolean }> = [
    { entry: 0, identical: true, contradicting: false },
    { entry: 2, identical: true, contradicting: true },
    { entry: 3, identical: true, contradicting: false },
    { entry: 4, identical: true, contradicting: true },
    { entry: 5, identical: false, contradicting: false },
  ];
  for (const row of expected) {
    const probe = requireElement(CALIBRATION_BANK, row.entry);
    cases.push({
      id: `jc-${String(row.entry)}-identical`,
      callSite: "quiz_judge",
      call: (prompt) => buildJudgeCall(prompt, { questionText: probe.questionText, answer1: probe.answerA, answer2: probe.answerA }),
      content: row.identical ? AGREE : DISAGREE,
    });
    cases.push({
      id: `jc-${String(row.entry)}-contradicting`,
      callSite: "quiz_judge",
      call: (prompt) => buildJudgeCall(prompt, { questionText: probe.questionText, answer1: probe.answerA, answer2: probe.answerB }),
      content: row.contradicting ? AGREE : DISAGREE,
    });
  }
  return cases;
}

// The item cases j1-01 to j1-10 and j2-01 to j2-10, and the unreadable variant j2-06-variant (4.20).
function itemCases(): FixtureCase[] {
  const cases: FixtureCase[] = [];
  for (const run of [1, 2] as const) {
    const verdicts = run === 1 ? RUN_1_VERDICTS : RUN_2_VERDICTS;
    for (let position = 1; position <= 10; position += 1) {
      const question = requireElement(QUIZ_BANK, position - 1).text;
      const order = orderForJudge(itemAt(position), run);
      cases.push({
        id: `j${String(run)}-${String(position).padStart(2, "0")}`,
        callSite: "quiz_judge",
        call: (prompt) => buildJudgeCall(prompt, { questionText: question, answer1: order.answer1, answer2: order.answer2 }),
        content: requireElement(verdicts, position - 1) ? AGREE : DISAGREE,
      });
    }
  }
  const variantOrder = orderForJudge({ ...itemAt(6), humanAnswer: FIXTURE_HUMAN_ANSWER_6_VARIANT }, 2);
  cases.push({
    id: "j2-06-variant",
    callSite: "quiz_judge",
    call: (prompt) => buildJudgeCall(prompt, { questionText: requireElement(QUIZ_BANK, 5).text, answer1: variantOrder.answer1, answer2: variantOrder.answer2 }),
    content: { agree: true, reason: "" },
  });
  return cases;
}

// All 43 fixture cases, persona answers first, then judge calls (4.19, 4.20).
export function fixtureCases(): FixtureCase[] {
  return [...personaCases(), ...calibrationCases(), ...itemCases()];
}

// The exact body the model client sends for a call: buildChatRequest with stream false, as LlmClient.complete builds it (dossier spec 4.7 step 2).
export function requestBodyFor(call: QuizModelCall): Record<string, unknown> {
  return buildChatRequest({ callSite: call.callSite, messages: call.messages, schema: call.schema, stream: false });
}

// Writes <outDir>/<id>.request.json and <outDir>/<id>.response.json for one case, for the write-fixture command of llm.
export async function writeFixtureCaseFiles(caseId: string, outDir: string): Promise<void> {
  const fixture = fixtureCases().find((candidate) => candidate.id === caseId);
  if (fixture === undefined) {
    throw new ContractError("fixture_case_unknown", "No quiz fixture case has this id. Pass all, or an id from sections 4.19 and 4.20 of the quiz spec.", 400);
  }
  const prompt = readPrompt(fixture.callSite === "quiz_answer" ? "quiz-persona-answer" : "quiz-judge");
  const call = fixture.call(prompt);
  await mkdir(outDir, { recursive: true });
  const request = JSON.stringify({ callSite: call.callSite, promptVersion: call.promptVersion, body: requestBodyFor(call) }, null, 2);
  const response = JSON.stringify(
    {
      response: { choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(fixture.content) }, finish_reason: "stop" }] },
      usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 },
    },
    null,
    2,
  );
  await writeFile(join(outDir, `${fixture.id}.request.json`), request);
  await writeFile(join(outDir, `${fixture.id}.response.json`), response);
}

// Writes every case when the target is "all", else the one case named. The second argument is the folder to write into.
export async function main(args: readonly string[]): Promise<void> {
  const [target, outDir] = args;
  if (target === undefined || outDir === undefined) {
    throw new ContractError("fixture_out_dir_missing", "Pass the folder to write into as the second argument.", 400);
  }
  if (target === "all") {
    for (const fixture of fixtureCases()) {
      await writeFixtureCaseFiles(fixture.id, outDir);
    }
    return;
  }
  await writeFixtureCaseFiles(target, outDir);
}

// The command line entry. It runs only when this file is run directly, so the integration test can import the cases without writing files.
if (process.argv[1]?.endsWith("quiz-fixtures.ts") === true) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
