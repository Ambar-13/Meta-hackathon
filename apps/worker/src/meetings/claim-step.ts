import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import { ContractError } from "@meet-first/contracts";
import { withMeeting, type Database } from "@meet-first/db";
import type { ChatMessage } from "@meet-first/llm";

// One tool call as the stored messages keep it.
const StoredToolCall = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
// One stored message, in the four shapes the chat request uses.
const StoredMessage = z.union([
  z.object({ role: z.literal("system"), content: z.string() }),
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(StoredToolCall).optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string().min(1), content: z.string() }),
]);

// The stored messages of a step, checked when read back from meeting_steps.messages.
export const StoredMessages = z
  .array(StoredMessage)
  .transform((list): ChatMessage[] => list.map(toChatMessage));
// The output of a done step: {text, toolCalls, claimsCommitted}.
export const StepOutput = z.object({
  text: z.string(),
  toolCalls: z.array(z.object({ name: z.string(), arguments: z.string() })),
  claimsCommitted: z.number().int().min(0),
});
// A step row as the jobs use it.
export type StepRow = {
  meetingId: string;
  stepSeq: number;
  side: "a" | "b";
  phase: "open" | "explore" | "decide";
  state: "pending" | "running" | "stalled" | "done";
  attempt: number;
  toolRounds: number;
  messages: ChatMessage[];
  partialText: string;
};
// The four ways a claim can end.
export type ClaimOutcome =
  | { kind: "claimed"; step: StepRow }
  | { kind: "done"; output: z.infer<typeof StepOutput> }
  | { kind: "busy" }
  | { kind: "missing" };
// The step this runner holds: the meeting, the step and the attempt it was claimed with.
export type HeldRef = { meetingId: string; stepSeq: number; attempt: number };

// Claims one step with a conditional UPDATE; one row back means this runner owns the step.
export async function claimStep(
  trx: Transaction<Database>,
  meetingId: string,
  stepSeq: number,
): Promise<ClaimOutcome> {
  const claimed = await trx
    .updateTable("meeting_steps")
    .set((eb) => ({
      state: "running",
      attempt: eb("attempt", "+", 1),
      claimed_at: sql<Date>`now()`,
    }))
    .where("meeting_id", "=", meetingId)
    .where("step_seq", "=", stepSeq)
    .where("state", "in", ["pending", "stalled"])
    .returningAll()
    .executeTakeFirst();
  if (claimed !== undefined) {
    return {
      kind: "claimed",
      step: {
        meetingId,
        stepSeq,
        side: claimed.side,
        phase: claimed.phase,
        state: "running",
        attempt: claimed.attempt,
        toolRounds: claimed.tool_rounds,
        messages: StoredMessages.parse(claimed.messages),
        partialText: claimed.partial_text,
      },
    };
  }
  return readUnclaimed(trx, meetingId, stepSeq);
}

// Moves a step this runner holds back to pending or to stalled; false when the runner no longer holds it.
export async function releaseStep(
  trx: Transaction<Database>,
  held: HeldRef,
  to: "pending" | "stalled",
): Promise<boolean> {
  const result = await updateHeldStep(trx, held).set({ state: to }).executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Saves the messages and the request count after a tool round, only while this runner holds the step.
export async function saveRound(
  trx: Transaction<Database>,
  held: HeldRef,
  round: { messages: ChatMessage[]; toolRounds: number },
): Promise<boolean> {
  const result = await updateHeldStep(trx, held)
    .set({
      messages: sql<never>`${JSON.stringify(round.messages)}::jsonb`,
      tool_rounds: round.toolRounds,
    })
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Writes the attempt's partial text and its UTF-16 length, only while this runner holds the step.
export async function savePartialText(
  trx: Transaction<Database>,
  held: HeldRef,
  text: string,
): Promise<boolean> {
  const result = await updateHeldStep(trx, held)
    .set({ partial_text: text, partial_len: text.length })
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Saves the partial text in its own short transaction, then sends the d: NOTIFY with the attempt and the UTF-16 length.
export async function writePartial(
  db: Kysely<Database>,
  held: HeldRef,
  text: string,
): Promise<void> {
  await withMeeting(db, held.meetingId, async (trx) => {
    const isStillHeld = await savePartialText(trx, held, text);
    if (!isStillHeld)
      throw new ContractError(
        "step_claim_lost",
        "Another runner took over this step, so this runner stops without writing.",
        409,
      );
    await sql`SELECT pg_notify('meeting_events', ${"d:" + held.meetingId + ":" + String(held.stepSeq) + ":" + String(held.attempt) + ":" + String(text.length)})`.execute(
      trx,
    );
  });
}

// Stamps first_token_at once per attempt, in its own short transaction, for the first-turn latency metric.
export async function recordFirstToken(
  db: Kysely<Database>,
  held: HeldRef,
  now: Date,
): Promise<void> {
  await withMeeting(db, held.meetingId, (trx) =>
    updateHeldStep(trx, held)
      .set({ first_token_at: now })
      .where("first_token_at", "is", null)
      .execute(),
  );
}

// The WHERE of every write after the claim: this step, this attempt, still running.
function updateHeldStep(trx: Transaction<Database>, held: HeldRef) {
  return trx
    .updateTable("meeting_steps")
    .where("meeting_id", "=", held.meetingId)
    .where("step_seq", "=", held.stepSeq)
    .where("attempt", "=", held.attempt)
    .where("state", "=", "running");
}

// Reads a step that could not be claimed: missing, done (its output is returned) or held by another runner.
async function readUnclaimed(
  trx: Transaction<Database>,
  meetingId: string,
  stepSeq: number,
): Promise<ClaimOutcome> {
  const row = await trx
    .selectFrom("meeting_steps")
    .select(["state", "output"])
    .where("meeting_id", "=", meetingId)
    .where("step_seq", "=", stepSeq)
    .executeTakeFirst();
  if (row === undefined) return { kind: "missing" };
  if (row.state === "done") return { kind: "done", output: StepOutput.parse(row.output) };
  return { kind: "busy" };
}

// One stored message as the chat request type expects it; the optional tool calls are added only when present.
function toChatMessage(message: z.infer<typeof StoredMessage>): ChatMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.tool_calls === undefined ? {} : { tool_calls: message.tool_calls }),
    };
  }
  return message;
}
