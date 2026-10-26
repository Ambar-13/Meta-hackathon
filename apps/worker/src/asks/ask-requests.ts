// What the run_ask job sends to the model, built without the database, and the checks that read what comes back: an ask's question
// check, one persona's answer request, the support check of the answers' quotes, and the quote check of each claim.
import { BriefSupportJudgeOutput, PersonaAnswerOutput, QuestionCheckOutput, toStrictJsonSchema, type AskMode, type BriefPoint, type QuestionKind } from "@meet-first/contracts";
import { queryWords } from "@meet-first/db";
import type { ChatMessage, CompleteArgs } from "@meet-first/llm";
import { verifyQuote } from "@meet-first/receipts";
import { promptBodyOf } from "../briefs/brief-lines.js";
import { isFlippedLine } from "../briefs/support-judge.js";
import { escapeBlockText, turnLabel } from "../meetings/prompt-builder.js";
import { parseTurnLabel, type CitableTurn } from "../meetings/receipts.js";

// The fields of an ask its question check reads.
export type AskForCheck = { mode: AskMode; text: string; aboutName: string | null };
// What every model call of the job carries besides its messages: the asker, whose ledger row the call writes, and the prompt version.
export type AskCallInput = { askerId: string; promptVersion: string; messages: ChatMessage[] };
// One approved, verified card item as a persona request shows it; turnIndex is turns.turn_index of the item's turn.
export type PersonaItem = { turnIndex: number; kind: string; claim: string; quote: string };
// One recall result as a persona request shows it: the turn's index and the snippet the search returned (D38).
export type RecallLine = { turnIndex: number; text: string };
// Everything the user message of one persona_answer call holds (design section 4 step 4).
export type PersonaAnswerInput = {
  mode: AskMode; askText: string; subjectName: string; askerName: string;
  items: readonly PersonaItem[]; recall: readonly RecallLine[]; misses: readonly string[];
};
// The two prompt texts a persona_answer system message joins.
export type PersonaPromptTexts = { personaAnswer: string; untrustedRules: string };
// One claim as persona_answers.claims stores it (migration 0006): turnId is the turn's id when the quote was found, else null;
// supported stays null until the support check backs the claim (true) or not (false).
export type StoredAnswerClaim = { text: string; quote: string; turnId: string | null; verified: boolean; supported: boolean | null };
// One verified claim as the support check reads it.
export type JudgeClaim = { text: string; quote: string; turnId: string };

// The user message of an ask's question check: the ask inside ask_question tags, escaped, with the friend's name in the about
// attribute of a react ask, escaped and with every double quote removed (design section 3, R7.3). A missing name is empty [confirm].
export function askCheckUserText(ask: AskForCheck): string {
  const text = escapeBlockText(ask.text);
  if (ask.mode === "help") return '<ask_question for="help">' + text + "</ask_question>";
  const name = escapeBlockText(ask.aboutName ?? "").replaceAll('"', "");
  return '<ask_question for="react" about="' + name + '">' + text + "</ask_question>";
}

// The two messages of an ask's question check: the question-check prompt as the system message, then the ask.
export function askCheckMessages(promptText: string, ask: AskForCheck): ChatMessage[] {
  return [
    { role: "system", content: promptText },
    { role: "user", content: askCheckUserText(ask) },
  ];
}

// The client arguments of an ask's question check, on the asker's ledger row (design section 3).
export function askCheckCallArgs(input: AskCallInput): CompleteArgs {
  return {
    callSite: "question_check",
    promptVersion: input.promptVersion,
    messages: input.messages,
    schema: toStrictJsonSchema(QuestionCheckOutput, "question-check"),
    ledger: { personId: input.askerId, meetingId: null },
  };
}

// The kind an allowed ask is stored with: romance when the check marked the ask romantic or gave the kind romance, else the
// check's own kind (design section 11, as-built item 54).
export function askKindOf(verdict: QuestionCheckOutput): QuestionKind {
  return verdict.romantic || verdict.kind === "romance" ? "romance" : verdict.kind;
}

// A display name on one line with no tag characters: the rule of promptName in meetings/prompt-builder.ts, which that file does not export.
// In words: control characters and line or paragraph breaks become a space, every <, > and & is removed, runs of spaces become one, and
// the ends are trimmed. The result holds no <, > or &, so escapeBlockText would change nothing in it and is not called.
export function promptLine(name: string): string {
  return name.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/[<>&]/g, "").replace(/ {2,}/g, " ").trim();
}

// The user message of one persona_answer call, line by line as design section 4 step 4 gives it. The ask text and the names are
// escaped; item quotes, claims and recall texts are not, because each quote must match its turn exactly, as in the meeting prefix.
export function personaAnswerUserText(input: PersonaAnswerInput): string {
  const lines = [
    '<ask kind="' + input.mode + '">' + escapeBlockText(input.askText) + "</ask>",
    "<people>your human: " + promptLine(input.subjectName),
    "the person asking: " + promptLine(input.askerName) + "</people>",
    "<your_card>",
    ...(input.items.length === 0 ? ["(no items)"] : input.items.map(itemLine)),
    "</your_card>",
  ];
  if (input.recall.length > 0) lines.push("<recall_result>", ...input.recall.map((row) => "[" + turnLabel(row.turnIndex) + "] " + row.text), "</recall_result>");
  if (input.misses.length > 0) lines.push("<do_not_guess>", ...input.misses.map((text) => "- " + text), "</do_not_guess>");
  return lines.join("\n");
}

// The two messages of one persona_answer call: the persona-answer prompt, a blank line and the untrusted-data rules as the system
// message, then the data blocks as the user message.
export function personaAnswerMessages(texts: PersonaPromptTexts, input: PersonaAnswerInput): ChatMessage[] {
  return [
    { role: "system", content: texts.personaAnswer + "\n\n" + texts.untrustedRules },
    { role: "user", content: personaAnswerUserText(input) },
  ];
}

// The client arguments of one persona_answer call, on the asker's ledger row (design section 4 step 4).
export function personaAnswerCallArgs(input: AskCallInput): CompleteArgs {
  return {
    callSite: "persona_answer",
    promptVersion: input.promptVersion,
    messages: input.messages,
    schema: toStrictJsonSchema(PersonaAnswerOutput, "persona-answer"),
    ledger: { personId: input.askerId, meetingId: null },
  };
}

// The ask's words for directory_shortlist. They are split by the same rule as the recall search (queryWords in packages/db), so a word
// matches the same way in both: lower case, letters, marks and digits, no word "or", and at most 20 words.
export function shortlistWords(text: string): string[] {
  return queryWords(text);
}

// Checks each claim's quote inside the one turn its turn_id names, among the turns the request showed; a label naming no such turn
// leaves the claim unverified. The forbidden texts are the ask and the two prompts, so a quote cannot repeat them (D25, D26).
export function checkAnswerClaims(claims: PersonaAnswerOutput["claims"], turns: ReadonlyMap<number, CitableTurn>, forbidden: readonly string[]): StoredAnswerClaim[] {
  return claims.map((claim) => {
    const index = parseTurnLabel(claim.turn_id);
    const turn = index === null ? undefined : turns.get(index);
    if (turn === undefined) return { text: claim.text, quote: claim.quote, turnId: null, verified: false, supported: null };
    const result = verifyQuote({ quote: claim.quote, turnText: turn.text, turnNormText: turn.normText, forbidden });
    return { text: claim.text, quote: claim.quote, turnId: result.ok ? turn.turnId : null, verified: result.ok, supported: null };
  });
}

// The user message of one support-check call: one item per claim, indexed from 0 in the order given, in the brief check's format. The
// brief check's per-item order swap applies: the quote comes first when isFlippedLine says so (design section 4 step 5, A1). The
// items keep the order given and are not shuffled [confirm].
export function askJudgeUserText(claims: readonly JudgeClaim[]): string {
  const blocks = claims.flatMap((claim, index) => {
    const statement = "<statement>" + claim.text + "</statement>";
    const quote = '<quote>"' + claim.quote + '"</quote>';
    const body = isFlippedLine(judgePointOf(claim)) ? [quote, statement] : [statement, quote];
    return ['<item index="' + String(index) + '">', ...body, "</item>"];
  });
  return ["<items>", ...blocks, "</items>"].join("\n");
}

// The two messages of one support-check call: the brief-support-judge prompt without its first-line status comment, then the items.
export function askJudgeMessages(promptText: string, claims: readonly JudgeClaim[]): ChatMessage[] {
  return [
    { role: "system", content: promptBodyOf(promptText) },
    { role: "user", content: askJudgeUserText(claims) },
  ];
}

// The client arguments of one ask_support_judge call. The wire schema is the brief judge's, whose strict form carries no item count;
// rank-answers.ts checks the count of each reply (as-built item 49).
export function askJudgeCallArgs(input: AskCallInput): CompleteArgs {
  return {
    callSite: "ask_support_judge",
    promptVersion: input.promptVersion,
    messages: input.messages,
    schema: toStrictJsonSchema(BriefSupportJudgeOutput, "brief-support-judge"),
    ledger: { personId: input.askerId, meetingId: null },
  };
}

// One item line of <your_card>: the turn label, the kind, the claim and the quote in double quotes.
function itemLine(item: PersonaItem): string {
  return "[" + turnLabel(item.turnIndex) + "] " + item.kind + " | " + item.claim + ' | "' + item.quote + '"';
}

// A claim in the shape isFlippedLine reads. It reads only the text and the quote; side and verified are filled because the
// BriefPoint type requires them.
function judgePointOf(claim: JudgeClaim): BriefPoint {
  return { text: claim.text, quotes: [{ text: claim.quote, side: "b", turnId: claim.turnId, verified: true }], supported: null };
}
