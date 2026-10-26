// The run_ask job (design section 4): the question check, the answer rows, one persona answer per row, the support check and the places.
// It is safe to run again, because each stage starts from the state the stage before it stored.
import { ContractError, QuestionCheckOutput, type JobPayload } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { LimiterBusy, reenqueueAfterLimiter } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import type { JobContext, JobTask } from "../job-context.js";
import { askCheckCallArgs, askCheckMessages, askKindOf } from "./ask-requests.js";
import { moveAsk, readAsk, type AskMove, type AskRow } from "./ask-store.js";
import { chooseSubjects } from "./choose-subjects.js";
import { answerPending } from "./persona-answers.js";
import { rankAnswers } from "./rank-answers.js";

// The payload of one run: the ask and its asker.
type AskPayload = JobPayload<"run_ask">;
// What the question check gave: the verdict, a full token window, or a failure that fails the ask.
type CheckResult = QuestionCheckOutput | "limited" | "failed";

// Runs one ask from the stage it is in to its end, or until a full token window re-queues it 5 s later (design section 4, D58).
// A missing ask, and one that is done, refused or failed, is left as it is.
export const runAsk: JobTask<"run_ask"> = async (payload, context) => {
  let ask = await withPerson(context.db, payload.personId, (trx) => readAsk(trx, payload.askId));
  if (ask?.state === "checking") ask = await checkAsk(context, payload, ask);
  if (ask?.state === "asking") ask = await askPersonas(context, payload, ask);
  if (ask?.state === "ranking") await rankAnswers(context, payload, ask);
};

// Design step 2: the question check. Refused or failed ends the ask; allowed stores the kind and moves the ask to asking (design sections 3 and 11).
async function checkAsk(context: JobContext, payload: AskPayload, ask: AskRow): Promise<AskRow | null> {
  const verdict = await runQuestionCheck(context, ask);
  if (verdict === "limited") {
    await reenqueueAfterLimiter(context, "run_ask", payload);
    return null;
  }
  if (verdict === "failed") {
    await moveInAsker(context, ask, { from: "checking", to: "failed" });
    return null;
  }
  if (!verdict.allowed) {
    await moveInAsker(context, ask, { from: "checking", to: "refused", refusedReason: verdict.reason });
    return null;
  }
  const questionKind = askKindOf(verdict);
  const isMoved = await moveInAsker(context, ask, { from: "checking", to: "asking", questionKind });
  return isMoved ? { ...ask, state: "asking", questionKind } : null;
}

// The question check's one model call, on the asker's ledger. A full window is "limited". Any other failure, and a reply that breaks
// the schema, is "failed", so no persona ever sees an ask the check did not allow [confirm].
async function runQuestionCheck(context: JobContext, ask: AskRow): Promise<CheckResult> {
  const prompt = readPrompt("question-check");
  try {
    const result = await context.llm.complete(askCheckCallArgs({ askerId: ask.personId, promptVersion: prompt.version, messages: askCheckMessages(prompt.text, ask) }));
    const verdict = QuestionCheckOutput.safeParse(result.parsed);
    if (verdict.success) return verdict.data;
    context.log.warn({ code: "ask_check_reply_invalid", askId: ask.id }, "The question check reply did not match its schema, so the ask fails.");
    return "failed";
  } catch (error) {
    if (error instanceof LimiterBusy) return "limited";
    const code = error instanceof ContractError ? error.code : "ask_check_failed";
    context.log.warn({ code, askId: ask.id }, "The question check call failed, so the ask fails and no persona sees it.");
    return "failed";
  }
}

// Design steps 3 and 4: the answer rows, then one persona answer for each pending row; moves the ask to ranking when none is pending.
async function askPersonas(context: JobContext, payload: AskPayload, ask: AskRow): Promise<AskRow | null> {
  const subjects = await chooseSubjects(context, ask);
  if (subjects !== "rows") {
    await moveInAsker(context, ask, { from: "asking", to: subjects === "none" ? "done" : "failed" });
    return null;
  }
  const answered = await answerPending(context, ask);
  if (answered === "limited") {
    await reenqueueAfterLimiter(context, "run_ask", payload);
    return null;
  }
  const isMoved = await moveInAsker(context, ask, { from: "asking", to: "ranking" });
  return isMoved ? { ...ask, state: "ranking" } : null;
}

// Moves the ask in its asker's context, the only context whose policy lets the job write it, and says whether it moved.
function moveInAsker(context: JobContext, ask: AskRow, change: Omit<AskMove, "askId" | "now">): Promise<boolean> {
  return withPerson(context.db, ask.personId, (trx) => moveAsk(trx, { ...change, askId: ask.id, now: context.now() }));
}
