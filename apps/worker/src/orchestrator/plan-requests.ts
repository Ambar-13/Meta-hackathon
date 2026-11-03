// What the orchestrate job sends to the model and the checks it runs on what comes back, built without the database. The model proposes
// one action; the checks here decide it, so a plan never names a friend the person does not have or one whose switch is off (wave 7).
import { AskCreate, OrchestratorPlanOutput, toStrictJsonSchema, type OrchestratorAction, type OrchestratorFriends } from "@meet-first/contracts";
import type { ChatMessage, CompleteArgs } from "@meet-first/llm";
import { promptLine } from "../asks/ask-requests.js";
import { escapeBlockText } from "../meetings/prompt-builder.js";

// The most earlier messages of the thread the request shows, so a follow-up such as "and Jonah?" can be read, and a question corrected
// in pieces ("no not the integral but sum of", "0 to pi") is still read with the message it corrects; at 4, a chat on 3 Nov lost it
// by the third piece.
export const RECENT_MESSAGES_MAX = 10;
// The most characters of one earlier message the request shows.
export const RECENT_MESSAGE_MAX_CHARS = 300;
// The most characters of all the earlier messages together, each counted after its cut, so 8 messages of the full 300 fit.
export const RECENT_CHARS_MAX = 2_400;

// The sentence of a reply whose model call failed (wave 7 spec, worker step 4).
export const PLAN_FAILED_SENTENCE = "I could not work that out just now. Try again in a minute.";
// The sentence when a help or react plan came without a question that fits an ask.
export const NO_QUESTION_SENTENCE = "I could not turn that into a question to ask. Tell me in one sentence what you want to know.";
// The sentence when the person has no friends yet and asked how one would react.
export const NO_FRIENDS_SENTENCE = "You have no friends here yet. Find someone in Explore and send a friend request, then ask me how they would react.";

// One earlier message of the thread as the request shows it.
export type RecentMessage = { role: "you" | "agent"; text: string };
// Everything one plan request holds: the person's new message, the friends they had when they sent it, and the messages before it, oldest first.
export type PlanInput = { text: string; friends: OrchestratorFriends; recent: readonly RecentMessage[] };
// What the job writes for one reply after the checks: planned for an ask the person can run, done for words only.
export type CheckedPlan = {
  state: "planned" | "done"; action: OrchestratorAction; text: string; question: string | null; friendName: string | null; pairId: string | null;
};

// The earlier messages the request shows, oldest first: the newest RECENT_MESSAGES_MAX, each with line breaks as spaces and cut to
// RECENT_MESSAGE_MAX_CHARS, while their characters together fit RECENT_CHARS_MAX. The first one that does not fit is left out with
// every older one, so the request never skips a message in the middle of the thread.
export function recentWindow(messages: readonly RecentMessage[]): RecentMessage[] {
  const kept: RecentMessage[] = [];
  let chars = 0;
  for (const message of messages.slice(-RECENT_MESSAGES_MAX).reverse()) {
    const cut = Array.from(message.text.replace(/\s+/g, " ").trim()).slice(0, RECENT_MESSAGE_MAX_CHARS);
    chars += cut.length;
    if (chars > RECENT_CHARS_MAX) break;
    kept.push({ role: message.role, text: cut.join("") });
  }
  return kept.reverse();
}

// One earlier message on one line: who wrote it, then its text, escaped.
function recentLine(message: RecentMessage): string {
  return (message.role === "you" ? "you: " : "meety: ") + escapeBlockText(message.text);
}

// The user message of one plan call: the earlier messages recentWindow keeps, the friend list and the new message, each in its own
// block. Names go on one line with no tag characters, as promptLine makes them; the messages are escaped.
export function planUserText(input: PlanInput): string {
  const friends = input.friends.length === 0 ? ["(none)"] : input.friends.map((friend) => `${promptLine(friend.displayName)} | can be asked: ${friend.canAsk ? "yes" : "no"}`);
  const recent = recentWindow(input.recent);
  const lines = ["<recent>", ...(recent.length === 0 ? ["(none)"] : recent.map(recentLine)), "</recent>", "<friends>", ...friends, "</friends>"];
  lines.push("<message>" + escapeBlockText(input.text) + "</message>");
  return lines.join("\n");
}

// The two messages of one plan call: the orchestrator prompt as the system message, then the blocks.
export function planMessages(promptText: string, input: PlanInput): ChatMessage[] {
  return [
    { role: "system", content: promptText },
    { role: "user", content: planUserText(input) },
  ];
}

// The client arguments of one plan call, on the person's ledger row.
export function planCallArgs(input: { personId: string; promptVersion: string; messages: ChatMessage[] }): CompleteArgs {
  return {
    callSite: "orchestrator",
    promptVersion: input.promptVersion,
    messages: input.messages,
    schema: toStrictJsonSchema(OrchestratorPlanOutput, "orchestrator"),
    ledger: { personId: input.personId, meetingId: null },
  };
}

// A name as the friend match compares it: case and spaces ignored. Example: " Mira  Shah" and "mirashah" are the same key.
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

// The question as an ask would carry it, or null when POST /api/asks would refuse it (5 to 300 characters after trimming).
export function askableQuestion(question: string): string | null {
  const parsed = AskCreate.safeParse({ mode: "help", text: question });
  return parsed.success && Array.from(parsed.data.text).length >= 5 ? parsed.data.text : null;
}

// A reply with words only.
function wordsOnly(text: string): CheckedPlan {
  return { state: "done", action: "reply", text, question: null, friendName: null, pairId: null };
}

// The most friends the unknown-friend sentence names, so the reply stays short however many friends a person has.
export const NAMED_FRIENDS_MAX = 5;

// The sentence when the plan's friend matches nobody: up to NAMED_FRIENDS_MAX of the person's friends by name, or how to get one.
export function unknownFriendSentence(friends: OrchestratorFriends): string {
  if (friends.length === 0) return NO_FRIENDS_SENTENCE;
  const names = friends.slice(0, NAMED_FRIENDS_MAX).map((friend) => promptLine(friend.displayName)).join(", ");
  return friends.length > NAMED_FRIENDS_MAX ? `I could not tell which friend you mean. Your friends include: ${names}.` : `I could not tell which friend you mean. Your friends are: ${names}.`;
}

// The sentence when the friend a plan matched stopped being a friend before the plan was written.
export function goneFriendSentence(name: string): string {
  return `You are no longer friends with ${promptLine(name)}, so I cannot ask their agent.`;
}

// Decides what one plan becomes, never trusting the model: a react needs the friend to match exactly one friend of the snapshot by
// nameKey, with their switch on; help and react need a question that fits an ask. Anything else becomes words only, with a sentence
// from here in place of the model's words, because those described an ask that will not start.
export function checkPlan(plan: OrchestratorPlanOutput, friends: OrchestratorFriends): CheckedPlan {
  const reply = plan.reply.trim();
  if (plan.action === "reply") return wordsOnly(reply);
  const question = askableQuestion(plan.question);
  if (plan.action === "help") return question === null ? wordsOnly(NO_QUESTION_SENTENCE) : { state: "planned", action: "help", text: reply, question, friendName: null, pairId: null };
  const key = nameKey(plan.friend);
  // The model saw each name through promptLine, so a name is matched in that form and in its stored form.
  const matches = key === "" ? [] : friends.filter((friend) => nameKey(promptLine(friend.displayName)) === key || nameKey(friend.displayName) === key);
  const friend = matches[0];
  if (friend === undefined) return wordsOnly(unknownFriendSentence(friends));
  if (matches.length > 1) return wordsOnly(`You have more than one friend called ${promptLine(friend.displayName)}, so I cannot tell which one you mean. Ask them from your Friends page instead.`);
  if (!friend.canAsk) return wordsOnly(`${promptLine(friend.displayName)} has not turned on friend asks yet.`);
  if (question === null) return wordsOnly(NO_QUESTION_SENTENCE);
  return { state: "planned", action: "react", text: reply, question, friendName: friend.displayName, pairId: friend.pairId };
}
