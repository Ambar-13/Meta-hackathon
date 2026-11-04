import type { Transaction } from "kysely";
import {
  ContractError,
  type QuizCalibrationRun,
  type QuizJudgeOutput,
} from "@meet-first/contracts";
import type { Database } from "@meet-first/db";

// One calibration probe: answer A against itself must agree, and answer A against answer B must
// disagree.
export type CalibrationEntry = {
  index: number;
  questionText: string;
  answerA: string;
  answerB: string;
};

// The eight probes. None is a bank question, so a probe never doubles a real item. Each run uses
// one, picked from the quiz id.
export const CALIBRATION_BANK: readonly CalibrationEntry[] = [
  {
    index: 0,
    questionText: "How do you like to start a working day?",
    answerA: "I check my calendar, then do the hardest task first.",
    answerB: "I answer every message first and leave hard work for the afternoon.",
  },
  {
    index: 1,
    questionText: "What do you do with a free evening?",
    answerA: "I read at home and go to bed early.",
    answerB: "I go out with friends until late.",
  },
  {
    index: 2,
    questionText: "How do you handle a long meeting with no agenda?",
    answerA: "I ask for an agenda or leave politely.",
    answerB: "I sit through it and let it run its course.",
  },
  {
    index: 3,
    questionText: "How do you keep track of your tasks?",
    answerA: "One paper notebook that I check every morning.",
    answerB: "I keep it all in my head and never write lists.",
  },
  {
    index: 4,
    questionText: "How do you prefer to travel for work?",
    answerA: "By train, so I can work on the way.",
    answerB: "By plane, whatever gets me there fastest.",
  },
  {
    index: 5,
    questionText: "What do you do when someone gives you a big compliment?",
    answerA: "I say thanks and change the subject.",
    answerB: "I enjoy it and ask what they liked most.",
  },
  {
    index: 6,
    questionText: "Where do you like to sit in an office?",
    answerA: "Near a window, away from the door.",
    answerB: "Right by the door so I can leave quickly.",
  },
  {
    index: 7,
    questionText: "What do you do about a messy shared kitchen?",
    answerA: "I tidy it myself and say nothing.",
    answerB: "I leave it and put up a note asking people to tidy up.",
  },
];

// The probe for one run of one quiz. The first two hex characters of the quiz id pick the entry,
// and run 2 takes the next one, so a rerun sends different requests.
export function calibrationEntryFor(quizId: string, run: 1 | 2): CalibrationEntry {
  const start = Number.parseInt(quizId.slice(0, 2), 16);
  const entry = CALIBRATION_BANK[(start + run - 1) % CALIBRATION_BANK.length];
  if (entry === undefined) {
    throw new ContractError(
      "calibration_entry_missing",
      "The calibration bank has no entry for this quiz. Check that CALIBRATION_BANK holds eight entries.",
      500,
    );
  }
  return entry;
}

// One calibration call's result as the judge job hands it over: the parsed output, or null when the
// reply did not parse.
export type CalibrationCallResult = { output: QuizJudgeOutput | null; ledgerId: string };

// Checks one run. The identical pair must say agree, and the contradicting pair must not. An
// unreadable reply fails its pair.
export function checkCalibrationRun(args: {
  run: 1 | 2;
  entryIndex: number;
  results: readonly [CalibrationCallResult, CalibrationCallResult];
}): QuizCalibrationRun {
  const { run, entryIndex, results } = args;
  const [identical, contradicting] = results;
  const isIdenticalPassed = identical.output !== null && identical.output.agree;
  const isContradictingPassed = contradicting.output !== null && !contradicting.output.agree;
  return {
    run,
    entryIndex,
    isPassed: isIdenticalPassed && isContradictingPassed,
    pairs: [
      {
        pair: "identical",
        shouldAgree: true,
        output: identical.output,
        isPassed: isIdenticalPassed,
        ledgerId: identical.ledgerId,
      },
      {
        pair: "contradicting",
        shouldAgree: false,
        output: contradicting.output,
        isPassed: isContradictingPassed,
        ledgerId: contradicting.ledgerId,
      },
    ],
  };
}

// The question texts the persona got wrong, from a quiz's state and its items. Only a reliable
// judged quiz has misses.
export function missTexts(
  quiz: { state: string; reliable: boolean | null } | undefined,
  items: ReadonlyArray<{ questionId: number; questionText: string; agree: boolean | null }>,
): string[] {
  if (quiz === undefined) return [];
  if (quiz.state !== "judged") return [];
  if (quiz.reliable !== true) return [];
  return items
    .filter((item) => item.agree === false)
    .sort((left, right) => left.questionId - right.questionId)
    .map((item) => item.questionText);
}

// The question texts the persona got wrong for one card's quiz, for the "ask, do not guess" lines
// of the meeting prefix.
export async function quizMisses(trx: Transaction<Database>, cardId: string): Promise<string[]> {
  const quiz = await trx
    .selectFrom("quizzes")
    .select(["id", "state", "reliable"])
    .where("card_id", "=", cardId)
    .executeTakeFirst();
  if (quiz === undefined) return missTexts(undefined, []);
  const rows = await trx
    .selectFrom("quiz_items")
    .innerJoin("quiz_bank", (join) =>
      join
        .onRef("quiz_bank.bank_version", "=", "quiz_items.bank_version")
        .onRef("quiz_bank.question_id", "=", "quiz_items.question_id"),
    )
    .select(["quiz_items.question_id", "quiz_bank.text", "quiz_items.agree"])
    .where("quiz_items.quiz_id", "=", quiz.id)
    .execute();
  return missTexts(
    quiz,
    rows.map((row) => ({ questionId: row.question_id, questionText: row.text, agree: row.agree })),
  );
}
