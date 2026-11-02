// The orchestrate job (wave 7): reads one thinking reply with the message it answers, asks the model for one plan, checks the plan in
// code against the friends snapshot, and writes it. It is safe to run again: a reply that is no longer thinking is left as it is.
import { ContractError, OrchestratorFriends, OrchestratorPlanOutput } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import { CapReached, LimiterBusy } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import type { JobContext, JobTask } from "../job-context.js";
import { checkPlan, goneFriendSentence, PLAN_FAILED_SENTENCE, planCallArgs, planMessages, RECENT_MESSAGES_MAX, type CheckedPlan, type PlanInput, type RecentMessage } from "./plan-requests.js";

// The sentence of a reply when a dollar cap stopped the call, by the cap's code (D60).
const CAP_SENTENCES: Readonly<Record<string, string>> = {
  daily_cap_reached: "Meet First has used today's model budget, so I cannot plan this now. Try again tomorrow.",
  total_cap_reached: "Meet First's model budget for this event is used up, so I cannot plan this.",
};

// What a failed call writes: the sentence, and no action.
export type FailedPlan = { state: "failed"; text: string };

// Reads a thinking reply with the person's message, the friends snapshot and the earlier messages, oldest first; null when the reply
// is gone or no longer thinking, which is also what row security shows for another person's reply.
async function readPlanInput(trx: DatabaseTransaction, messageId: string): Promise<PlanInput | null> {
  const reply = await trx.selectFrom("orchestrator_messages").select(["id", "state", "reply_to", "friends_snapshot", "created_at"])
    .where("id", "=", messageId).where("role", "=", "agent").executeTakeFirst();
  if (reply?.state !== "thinking" || reply.reply_to === null) return null;
  const message = await trx.selectFrom("orchestrator_messages").select("text").where("id", "=", reply.reply_to).executeTakeFirst();
  if (message === undefined) return null;
  const earlier = await trx.selectFrom("orchestrator_messages").select(["role", "text"])
    .where("created_at", "<", reply.created_at).where("state", "in", ["planned", "running", "done"]).where("text", "<>", "")
    .orderBy("created_at", "desc").orderBy("role", "asc").limit(RECENT_MESSAGES_MAX).execute();
  const recent: RecentMessage[] = earlier.reverse().map((row) => ({ role: row.role, text: row.text }));
  return { text: message.text, friends: OrchestratorFriends.parse(reply.friends_snapshot), recent };
}

// The one model call and the checks; a dollar cap or any other failure becomes a failed reply with its sentence, and a full token
// window is thrown on, so the runner queues the job again in 5 s.
async function planReply(context: JobContext, input: { personId: string; messageId: string; plan: PlanInput }): Promise<CheckedPlan | FailedPlan> {
  const prompt = readPrompt("orchestrator");
  try {
    const result = await context.llm.complete(planCallArgs({ personId: input.personId, promptVersion: prompt.version, messages: planMessages(prompt.text, input.plan) }));
    const parsed = OrchestratorPlanOutput.safeParse(result.parsed);
    if (parsed.success) return checkPlan(parsed.data, input.plan.friends);
    context.log.warn({ code: "orchestrator_reply_invalid", messageId: input.messageId }, "The orchestrator reply did not match its schema, so the reply fails.");
    return { state: "failed", text: PLAN_FAILED_SENTENCE };
  } catch (error) {
    if (error instanceof LimiterBusy) throw error;
    if (error instanceof CapReached) return { state: "failed", text: CAP_SENTENCES[error.code] ?? PLAN_FAILED_SENTENCE };
    const code = error instanceof ContractError ? error.code : "orchestrator_call_failed";
    context.log.warn({ code, messageId: input.messageId }, "The orchestrator call failed, so the reply fails.");
    return { state: "failed", text: PLAN_FAILED_SENTENCE };
  }
}

// Writes the plan onto the reply, only while it is still thinking, so a second run that lost a race writes nothing.
async function writePlan(trx: DatabaseTransaction, messageId: string, plan: CheckedPlan | FailedPlan): Promise<void> {
  const values = plan.state === "failed"
    ? { state: plan.state, text: plan.text }
    : { state: plan.state, text: plan.text, action: plan.action, action_question: plan.question, action_friend_name: plan.friendName, action_pair_id: plan.pairId };
  await trx.updateTable("orchestrator_messages").set(values).where("id", "=", messageId).where("state", "=", "thinking").execute();
}

// True when Postgres refused a write because a row it points to is gone (SQLSTATE 23503), as the pair of a friend who deleted their account.
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "23503";
}

// What a reply becomes when its plan could not be written: words saying the friend is gone, when the plan's pair was deleted while the
// model worked, else the failed sentence. Either way the job ends here, so a retry never calls the model a second time.
export function fallbackPlan(plan: CheckedPlan | FailedPlan, error: unknown): CheckedPlan | FailedPlan {
  if (isForeignKeyViolation(error) && plan.state === "planned" && plan.friendName !== null) {
    return { state: "done", action: "reply", text: goneFriendSentence(plan.friendName), question: null, friendName: null, pairId: null };
  }
  return { state: "failed", text: PLAN_FAILED_SENTENCE };
}

// Plans one reply from thinking to planned, done or failed. A missing reply, and one already planned, is left as it is.
export const orchestrate: JobTask<"orchestrate"> = async (payload, context) => {
  const input = await withPerson(context.db, payload.personId, (trx) => readPlanInput(trx, payload.messageId));
  if (input === null) return;
  const plan = await planReply(context, { personId: payload.personId, messageId: payload.messageId, plan: input });
  try {
    await withPerson(context.db, payload.personId, (trx) => writePlan(trx, payload.messageId, plan));
  } catch (error) {
    context.log.warn({ code: "orchestrator_write_failed", messageId: payload.messageId }, "The plan could not be written, so the reply gets the fallback words.");
    await withPerson(context.db, payload.personId, (trx) => writePlan(trx, payload.messageId, fallbackPlan(plan, error)));
  }
};
