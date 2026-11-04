// What exists: help searches and friend asks start from their own screens. The problem: a person
// should be able to say what they want in one chat ("who could help me with X", "how would Mira
// react to Y") and have the right ask start, with every check a button press gets. The step: POST
// writes the person's message and a thinking reply and enqueues the orchestrate job, which plans
// one action; the run route starts the planned ask through createAsk, the function POST /api/asks
// uses, so the caps, the friendship and the friend's switch hold. What they do not do: start an ask
// the person did not confirm, or take the model's word for a friend; the job matched the name
// against the friends the person had when they sent the message.
import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import {
  AskCreate,
  ContractError,
  HTTP,
  ORCHESTRATOR_MESSAGES_PER_DAY,
  ORCHESTRATOR_THREAD_MAX,
  OrchestratorMessage,
  OrchestratorSend,
  OrchestratorSendResponse,
  OrchestratorThread,
  routes,
  Uuid,
} from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { createAsk, type AskDeps } from "../asks/create-ask.js";
import { startOfUtcDay } from "../meetings/create-meeting.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of the run route: a reply's id. One that is not a uuid is not_found, so a bad id tells
// nothing.
const MessageParams = z.object({ id: Uuid });
// The sentence when the person has sent ORCHESTRATOR_MESSAGES_PER_DAY messages this UTC day.
const DAILY_CAP_SENTENCE = "You have sent today's messages to Meety. Try again tomorrow.";

// One row of orchestrator_messages as the thread reads it.
type MessageRow = {
  id: string;
  role: "you" | "agent";
  text: string;
  state: "thinking" | "planned" | "running" | "done" | "failed";
  action: "help" | "react" | "reply" | null;
  action_question: string | null;
  action_friend_name: string | null;
  action_pair_id: string | null;
  ask_id: string | null;
  created_at: Date;
};
// One row of friend_list() as the snapshot takes it (migration 0008).
type FriendRow = { pair_id: string; display_name: string; can_ask: boolean };

// The thread view of one message row.
export function toOrchestratorMessage(row: MessageRow): OrchestratorMessage {
  return OrchestratorMessage.parse({
    id: row.id,
    role: row.role,
    text: row.text,
    state: row.state,
    action: row.action,
    actionQuestion: row.action_question,
    actionFriendName: row.action_friend_name,
    askId: row.ask_id,
    createdAt: row.created_at.toISOString(),
  });
}

// Reads one of the caller's replies, locked for this transaction, or undefined when the caller has
// no reply with this id.
async function readReplyForUpdate(
  trx: Transaction<Database>,
  input: { personId: string; messageId: string },
): Promise<MessageRow | undefined> {
  return trx
    .selectFrom("orchestrator_messages")
    .select([
      "id",
      "role",
      "text",
      "state",
      "action",
      "action_question",
      "action_friend_name",
      "action_pair_id",
      "ask_id",
      "created_at",
    ])
    .where("id", "=", input.messageId)
    .where("person_id", "=", input.personId)
    .where("role", "=", "agent")
    .forUpdate()
    .executeTakeFirst();
}

// The latest ORCHESTRATOR_THREAD_MAX messages of the caller's thread, oldest first. A message and
// its reply share created_at, because one transaction writes both, so the reply sorts after the
// message it answers.
async function readThread(
  trx: Transaction<Database>,
  personId: string,
): Promise<OrchestratorThread> {
  const rows = await trx
    .selectFrom("orchestrator_messages")
    .select([
      "id",
      "role",
      "text",
      "state",
      "action",
      "action_question",
      "action_friend_name",
      "action_pair_id",
      "ask_id",
      "created_at",
    ])
    .where("person_id", "=", personId)
    .orderBy("created_at", "desc")
    .orderBy(sql`CASE WHEN role = 'agent' THEN 0 ELSE 1 END`)
    .orderBy("id", "desc")
    .limit(ORCHESTRATOR_THREAD_MAX)
    .execute();
  return OrchestratorThread.parse({
    messages: rows.reverse().map((row) => toOrchestratorMessage(row)),
  });
}

// Writes the person's message and a thinking reply that holds the friend list as it is now. The
// caller's people row is locked first, so messages sent at the same moment take turns and none can
// pass the daily count.
async function insertExchange(
  trx: Transaction<Database>,
  input: { personId: string; text: string; now: Date },
): Promise<{ messageId: string; replyId: string }> {
  await trx
    .selectFrom("people")
    .select("id")
    .where("id", "=", input.personId)
    .forUpdate()
    .execute();
  // In words: how many messages the caller has sent the orchestrator since midnight UTC today.
  const sent = await trx
    .selectFrom("orchestrator_messages")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("person_id", "=", input.personId)
    .where("role", "=", "you")
    .where("created_at", ">=", startOfUtcDay(input.now))
    .executeTakeFirstOrThrow();
  if (Number(sent.count) >= ORCHESTRATOR_MESSAGES_PER_DAY)
    throw new ContractError("orchestrator_daily_cap", DAILY_CAP_SENTENCE, HTTP.tooMany);
  const friends =
    await sql<FriendRow>`SELECT pair_id, display_name, can_ask FROM friend_list()`.execute(trx);
  const snapshot = friends.rows.map((row) => ({
    pairId: row.pair_id,
    displayName: row.display_name,
    canAsk: row.can_ask,
  }));
  const message = await trx
    .insertInto("orchestrator_messages")
    .values({ person_id: input.personId, role: "you", text: input.text, state: "done" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const reply = await trx
    .insertInto("orchestrator_messages")
    .values({
      person_id: input.personId,
      role: "agent",
      text: "",
      state: "thinking",
      reply_to: message.id,
      friends_snapshot: JSON.stringify(snapshot),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { messageId: message.id, replyId: reply.id };
}

// The ask a planned reply starts, as POST /api/asks would read it, or the sentence that says why it
// cannot start.
export function askBodyOf(row: MessageRow): { body: AskCreate } | { refusal: string } {
  const friendName = row.action_friend_name ?? "this friend";
  if (row.action === "react" && row.action_pair_id === null)
    return {
      refusal: `You are no longer friends with ${friendName}, so I could not ask their Meety.`,
    };
  const draft =
    row.action === "react"
      ? { mode: "react", pairId: row.action_pair_id, text: row.action_question }
      : { mode: "help", text: row.action_question };
  const parsed = AskCreate.safeParse(draft);
  return parsed.success
    ? { body: parsed.data }
    : {
        refusal: "That question does not fit an ask. Say it in a sentence of 5 to 300 characters.",
      };
}

// The codes of createAsk that refuse the ask for good: a daily cap, the friend's switch, a
// friendship that ended, a question that does not fit. Any other error (the queue refusing the job,
// a dropped connection) puts the plan back, so the person can press again.
const REFUSAL_CODES: ReadonlySet<string> = new Set([
  "help_daily_cap",
  "react_daily_cap",
  "friend_asks_off",
  "not_found",
  "payload_invalid",
]);

// The sentence a refused ask adds to the reply: createAsk's own sentence, except not_found, which
// here means the friendship is gone.
export function refusalSentence(error: ContractError, row: MessageRow): string {
  if (error.code === "not_found")
    return `You are no longer friends with ${row.action_friend_name ?? "this friend"}, so I could not ask their Meety.`;
  if (error.code === "payload_invalid")
    return "That question does not fit an ask. Say it in a sentence of 5 to 300 characters.";
  return error.message;
}

// Writes what running a plan came to: the ask it started, or the reply settled as done with the
// refusal added below its words.
async function settleRun(
  deps: AskDeps,
  input: { personId: string; row: MessageRow; outcome: { askId: string } | { refusal: string } },
): Promise<MessageRow> {
  const { row, outcome } = input;
  const values =
    "askId" in outcome
      ? { ask_id: outcome.askId, state: "running" as const }
      : { text: `${row.text}\n\n${outcome.refusal}`, state: "done" as const };
  await withPerson(deps.db, input.personId, (trx) =>
    trx
      .updateTable("orchestrator_messages")
      .set(values)
      .where("id", "=", row.id)
      .where("person_id", "=", input.personId)
      .execute(),
  );
  return "askId" in outcome
    ? { ...row, ask_id: outcome.askId, state: "running" }
    : { ...row, text: values.text ?? row.text, state: "done" };
}

// Puts a claimed reply back to planned after an error that was not a refusal, so the person can
// press run again.
async function releaseClaim(
  deps: AskDeps,
  input: { personId: string; messageId: string },
): Promise<void> {
  await withPerson(deps.db, input.personId, (trx) =>
    trx
      .updateTable("orchestrator_messages")
      .set({ state: "planned" })
      .where("id", "=", input.messageId)
      .where("person_id", "=", input.personId)
      .where("state", "=", "running")
      .where("ask_id", "is", null)
      .execute(),
  );
}

// Claims a planned reply by moving it to running in its own transaction, so a second press finds it
// running and changes nothing. Returns the row as it was claimed, or the row unchanged when there
// is nothing to run.
async function claimPlan(
  deps: AskDeps,
  input: { personId: string; messageId: string },
): Promise<{ row: MessageRow; isClaimed: boolean }> {
  return withPerson(deps.db, input.personId, async (trx) => {
    const row = await readReplyForUpdate(trx, input);
    if (row === undefined) throw makeNotFoundError();
    if (row.state === "thinking")
      throw new ContractError(
        "plan_not_ready",
        "This reply is still being worked out. Wait a moment and try again.",
        HTTP.conflict,
      );
    if (row.state !== "planned") return { row, isClaimed: false };
    await trx
      .updateTable("orchestrator_messages")
      .set({ state: "running" })
      .where("id", "=", row.id)
      .execute();
    return { row, isClaimed: true };
  });
}

// Runs one planned reply: claims it, starts its ask through createAsk with every check of POST
// /api/asks, and writes what that came to. A refusal (a cap, the friend's switch, a friendship that
// ended) settles the reply as done with the sentence, never an error.
export async function runPlan(
  deps: AskDeps,
  input: { personId: string; messageId: string },
): Promise<OrchestratorMessage> {
  const claim = await claimPlan(deps, input);
  if (!claim.isClaimed) return toOrchestratorMessage(claim.row);
  const ask = askBodyOf(claim.row);
  if ("refusal" in ask)
    return toOrchestratorMessage(
      await settleRun(deps, { personId: input.personId, row: claim.row, outcome: ask }),
    );
  let askId: string;
  try {
    askId = await createAsk(deps, input.personId, ask.body);
  } catch (error) {
    if (error instanceof ContractError && REFUSAL_CODES.has(error.code)) {
      return toOrchestratorMessage(
        await settleRun(deps, {
          personId: input.personId,
          row: claim.row,
          outcome: { refusal: refusalSentence(error, claim.row) },
        }),
      );
    }
    await releaseClaim(deps, input);
    throw error;
  }
  return toOrchestratorMessage(
    await settleRun(deps, { personId: input.personId, row: claim.row, outcome: { askId } }),
  );
}

// Registers GET /api/orchestrator: 200 OrchestratorThread, the caller's latest messages oldest
// first. Never cached, because a reply changes while the job plans it.
export function registerReadThread(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.readThread.path, async (request, reply) => {
    const personId = requirePerson(request);
    const thread = await withPerson(deps.db, personId, (trx) => readThread(trx, personId));
    reply.header("cache-control", "no-store");
    return reply.code(200).send(thread);
  });
}

// Registers POST /api/orchestrator: 202 {messageId, replyId}; 400 payload_invalid; 429
// orchestrator_daily_cap. The orchestrate job is enqueued after the commit; when the queue refuses,
// both messages are deleted again and the queue's error goes on.
export function registerSendToOrchestrator(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.social.sendToOrchestrator.path, async (request, reply) => {
    const personId = requirePerson(request);
    const body = OrchestratorSend.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const ids = await withPerson(deps.db, personId, (trx) =>
      insertExchange(trx, { personId, text: body.data.text, now: deps.now() }),
    );
    try {
      await deps.enqueue("orchestrate", { messageId: ids.replyId, personId });
    } catch (error) {
      await withPerson(deps.db, personId, (trx) =>
        trx.deleteFrom("orchestrator_messages").where("id", "=", ids.messageId).execute(),
      );
      throw error;
    }
    return reply.code(202).send(OrchestratorSendResponse.parse(ids));
  });
}

// Registers POST /api/orchestrator/:id/run: 200 with the reply, now running with its askId, or done
// with the refusal sentence below its words; a reply already running or done comes back unchanged.
// 404 not_found for a reply that is not the caller's; 409 plan_not_ready while it is thinking.
export function registerRunPlan(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.social.runPlan.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = MessageParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const message = await runPlan(deps, { personId, messageId: params.data.id });
    return reply.code(200).send(message);
  });
}
