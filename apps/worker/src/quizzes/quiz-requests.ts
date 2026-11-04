import {
  ContractError,
  QuizJudgeOutput,
  QuizPersonaAnswerOutput,
  toStrictJsonSchema,
} from "@meet-first/contracts";
import type { ChatMessage } from "@meet-first/llm";

// The prompt text and its version as readPrompt returns them.
export type QuizPrompt = { version: string; text: string };

// One card item as the persona sees it.
export type PersonaCardItem = {
  position: number;
  kind: "value" | "preference" | "habit" | "boundary" | "goal";
  claim: string;
  gloss: string;
  quote: string;
};

// What one judge call compares: the question and two answers in the order the judge sees them.
export type JudgeInput = { questionText: string; answer1: string; answer2: string };

// The arguments of one model call. The same object serves LlmClient.complete and a fixture body.
export type QuizModelCall = {
  callSite: "quiz_answer" | "quiz_judge";
  promptVersion: string;
  messages: ChatMessage[];
  schema: { name: string; strict: true; schema: Record<string, unknown> };
};

// The strict output schema sent with each persona call. It matches the frozen v1/schema.json.
export const PERSONA_ANSWER_SCHEMA = toStrictJsonSchema(
  QuizPersonaAnswerOutput,
  "quiz-persona-answer",
);

// The strict output schema sent with each judge call. It matches the frozen v1/schema.json.
export const JUDGE_SCHEMA = toStrictJsonSchema(QuizJudgeOutput, "quiz-judge");

// The sentence a quiz job logs for each stop code, with what to do next (repo rule 3).
export const QUIZ_STOP_SENTENCES = {
  persona_card_empty:
    "The card has no item the persona may use. Build a new card and approve at least one verified item before starting the quiz.",
  persona_answer_unreadable:
    "The persona reply was not one answer of 1 to 200 characters. Build a new card to try the quiz again.",
  judge_output_unreadable:
    "The judge reply did not match its schema in the rerun. Build a new card to try the quiz again.",
  quiz_items_incomplete:
    "The quiz does not have ten items with both answers, so it cannot be judged. Build a new card to try the quiz again.",
  quiz_job_error:
    "The quiz job stopped on an error from the model client or the database. Read the code in this log line, then build a new card to try again.",
} as const;

// The codes a quiz job logs when it stops.
export type QuizStopCode = keyof typeof QUIZ_STOP_SENTENCES;

// The element at one place of a list. A missing place is a bug in the caller, so this throws (noUncheckedIndexedAccess in tsconfig.base.json).
export function requireElement<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new ContractError(
      "list_element_missing",
      "No element at place " + String(index) + ". Check the list and the index.",
      500,
    );
  }
  return value;
}

// Escapes &, < and > so that text from a card or an answer cannot close a block of the message.
export function escapeBlockText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// The card block of the persona message, with items numbered from 1 in the order given.
export function formatCardItems(items: readonly PersonaCardItem[]): string {
  const itemLines = items.flatMap((item, index) => [
    `<card_item n="${String(index + 1)}" kind="${item.kind}">`,
    `claim: ${escapeBlockText(item.claim)}`,
    `gloss: ${escapeBlockText(item.gloss)}`,
    `quote: ${escapeBlockText(item.quote)}`,
    "</card_item>",
  ]);
  return ["<card>", ...itemLines, "</card>"].join("\n");
}

// The call for one persona answer: the system prompt, then the card and one bank question, and nothing from the quiz tables.
export function buildPersonaAnswerCall(
  prompt: QuizPrompt,
  items: readonly PersonaCardItem[],
  questionText: string,
): QuizModelCall {
  return {
    callSite: "quiz_answer",
    promptVersion: prompt.version,
    messages: [
      { role: "system", content: prompt.text },
      {
        role: "user",
        content: `${formatCardItems(items)}\n<question>${escapeBlockText(questionText)}</question>`,
      },
    ],
    schema: PERSONA_ANSWER_SCHEMA,
  };
}

// The call for one judge verdict: the system prompt, then the question and the two answers, with no word about who wrote either.
export function buildJudgeCall(prompt: QuizPrompt, input: JudgeInput): QuizModelCall {
  const question = escapeBlockText(input.questionText);
  const answer1 = escapeBlockText(input.answer1);
  const answer2 = escapeBlockText(input.answer2);
  return {
    callSite: "quiz_judge",
    promptVersion: prompt.version,
    messages: [
      { role: "system", content: prompt.text },
      {
        role: "user",
        content: `<question>${question}</question>\n<answer_1>${answer1}</answer_1>\n<answer_2>${answer2}</answer_2>`,
      },
    ],
    schema: JUDGE_SCHEMA,
  };
}

// The order of one item for the judge. Run 1 shows the human answer first when flipped is true, and run 2 shows the other order.
export function orderForJudge(
  item: { personaAnswer: string; humanAnswer: string; flipped: boolean },
  run: 1 | 2,
): { answer1: string; answer2: string; isHumanFirst: boolean } {
  const isHumanFirst = run === 1 ? item.flipped : !item.flipped;
  return isHumanFirst
    ? { answer1: item.humanAnswer, answer2: item.personaAnswer, isHumanFirst }
    : { answer1: item.personaAnswer, answer2: item.humanAnswer, isHumanFirst };
}
