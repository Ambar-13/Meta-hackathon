import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";

// Messages a person may send the orchestrator per UTC day.
export const ORCHESTRATOR_MESSAGES_PER_DAY = 40;
// The longest message a person may send the orchestrator.
export const ORCHESTRATOR_MESSAGE_MAX_CHARS = 500;
// The most messages GET /api/orchestrator returns: the latest ones, oldest first.
export const ORCHESTRATOR_THREAD_MAX = 60;

// The body of POST /api/orchestrator: what the person asks.
export const OrchestratorSend = z.object({
  text: z.string().trim().min(1).max(ORCHESTRATOR_MESSAGE_MAX_CHARS),
});
// The type of OrchestratorSend, read from the schema above.
export type OrchestratorSend = z.infer<typeof OrchestratorSend>;

// One friend as the orchestrator saw them when the person sent a message: orchestrator_messages.friends_snapshot holds a list of these,
// and the orchestrate job checks the plan's friend against it, never against the model's word alone.
export const OrchestratorFriend = z.object({
  pairId: Uuid,
  displayName: z.string(),
  canAsk: z.boolean(),
});
// The type of OrchestratorFriend, read from the schema above.
export type OrchestratorFriend = z.infer<typeof OrchestratorFriend>;
// The friends snapshot of one reply, in friend_list order: most recently joined first.
export const OrchestratorFriends = z.array(OrchestratorFriend);
// The type of OrchestratorFriends, read from the schema above.
export type OrchestratorFriends = z.infer<typeof OrchestratorFriends>;

// What POST /api/orchestrator returns: the person's message and the orchestrator's reply, which is thinking until the worker plans it.
export const OrchestratorSendResponse = z.object({ messageId: Uuid, replyId: Uuid });
// The type of OrchestratorSendResponse, read from the schema above.
export type OrchestratorSendResponse = z.infer<typeof OrchestratorSendResponse>;

// Who wrote a message: the person, or their orchestrator.
export const OrchestratorRole = z.enum(["you", "agent"]);
// The type of OrchestratorRole, read from the schema above.
export type OrchestratorRole = z.infer<typeof OrchestratorRole>;

// Where a message stands. The person's own messages are done. A reply is thinking, then planned (an ask is ready to run), running (the
// ask is out), done, or failed.
export const OrchestratorState = z.enum(["thinking", "planned", "running", "done", "failed"]);
// The type of OrchestratorState, read from the schema above.
export type OrchestratorState = z.infer<typeof OrchestratorState>;

// The one thing a reply does: start a help search, start a friend ask, or only answer in words.
export const OrchestratorAction = z.enum(["help", "react", "reply"]);
// The type of OrchestratorAction, read from the schema above.
export type OrchestratorAction = z.infer<typeof OrchestratorAction>;

// One message of the thread. A reply's action fields say what it will ask or asked; askId links the ask once it runs.
export const OrchestratorMessage = z.object({
  id: Uuid,
  role: OrchestratorRole,
  text: z.string(),
  state: OrchestratorState,
  action: OrchestratorAction.nullable(),
  actionQuestion: z.string().nullable(),
  actionFriendName: z.string().nullable(),
  askId: Uuid.nullable(),
  createdAt: IsoTime,
});
// The type of OrchestratorMessage, read from the schema above.
export type OrchestratorMessage = z.infer<typeof OrchestratorMessage>;

// What GET /api/orchestrator returns: the latest messages of the person's one thread, oldest first.
export const OrchestratorThread = z.object({ messages: z.array(OrchestratorMessage) });
// The type of OrchestratorThread, read from the schema above.
export type OrchestratorThread = z.infer<typeof OrchestratorThread>;

// What the orchestrator model returns for one message (prompt orchestrator v1): one action, the friend it is about for a react ("" for
// help and reply), the question the ask will carry ("" for reply), and the words shown to the person. No field is nullable, because a
// strict schema with null types is not shown to work on the Meta Model API.
export const OrchestratorPlanOutput = z.object({
  action: OrchestratorAction,
  friend: z.string(),
  question: z.string(),
  reply: z.string().min(1).max(600),
});
// The type of OrchestratorPlanOutput, read from the schema above.
export type OrchestratorPlanOutput = z.infer<typeof OrchestratorPlanOutput>;
