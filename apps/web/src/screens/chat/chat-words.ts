// The pure parts of the chat page: the example chips, the greeting, the first-sentence cut of an answer, and the thread poll decision. Nothing here calls the api or React, so the unit tests read it in Node.
import { type OrchestratorMessage, type OrchestratorThread } from "@meet-first/contracts";

// Milliseconds between two reads of the thread while a reply is still thinking.
export const THREAD_POLL_MS = 1_500;
// How many characters may be used before the composer shows how many are left.
export const COUNTER_FROM_CHARS = 400;
// The longest first sentence an ask card shows for one answer, "..." included.
export const ANSWER_LINE_MAX = 140;
// The most answers an ask card shows.
export const ASK_CARD_ANSWERS_MAX = 3;

// The names the chips use when the person has too few friends.
const FIRST_FRIEND_FALLBACK = "Mira";
const SECOND_FRIEND_FALLBACK = "my investor";
// The cut marker at the end of a shortened answer line.
const CUT_MARK = "...";

// The three example chips under an empty thread: a help search, then how the first and the second friend would probably react. With no
// friends list (it failed to load or is empty) the names fall back to Mira and my investor.
export function chipTexts(friends: readonly { displayName: string }[] | null): readonly [string, string, string] {
  const first = friends?.[0]?.displayName.trim() ?? "";
  const second = friends?.[1]?.displayName.trim() ?? "";
  return [
    "Who could help me get my first ten users?",
    `How would ${first === "" ? FIRST_FRIEND_FALLBACK : first} react if I moved our trip to March?`,
    `How would ${second === "" ? SECOND_FRIEND_FALLBACK : second} prefer a seed extension over a bridge round?`,
  ];
}

// The greeting over an empty thread, with the person's name when it is known.
export function greetingOf(displayName: string | null): string {
  const name = displayName?.trim() ?? "";
  return name === "" ? "What do you want to find out?" : `Hi ${name}, what do you want to find out?`;
}

// The first sentence of an answer, at most ANSWER_LINE_MAX characters; a longer one is cut at a word and ends with "...".
export function firstSentence(text: string): string {
  const flat = text.trim().replace(/\s+/g, " ");
  const match = /^(.+?[.!?])(?=\s|$)/.exec(flat);
  const sentence = match?.[1] ?? flat;
  if (sentence.length <= ANSWER_LINE_MAX) return sentence;
  const room = sentence.slice(0, ANSWER_LINE_MAX - CUT_MARK.length + 1);
  const lastSpace = room.lastIndexOf(" ");
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room.slice(0, ANSWER_LINE_MAX - CUT_MARK.length);
  return `${cut.replace(/[\s,;:.!?-]+$/, "")}${CUT_MARK}`;
}

// True while any reply of the thread is still thinking, so the page reads the thread again THREAD_POLL_MS later. A running reply needs
// no thread read, because its ask card reads the ask.
export function shouldPollThread(thread: OrchestratorThread): boolean {
  return thread.messages.some((message) => message.state === "thinking");
}

// The person's own message nearest before a reply, which "Try again" puts back in the composer; null when there is none.
export function messageBefore(messages: readonly OrchestratorMessage[], replyId: string): string | null {
  const index = messages.findIndex((message) => message.id === replyId);
  const earlier = index < 0 ? [] : messages.slice(0, index);
  return earlier.reverse().find((message) => message.role === "you")?.text ?? null;
}

// The thread as the page shows it: the server's messages with the replies a run returned put in their place, then the messages sent
// from this page that the server's thread does not hold yet.
export function shownMessages(input: { server: readonly OrchestratorMessage[]; ran: ReadonlyMap<string, OrchestratorMessage>; sent: readonly OrchestratorMessage[] }): OrchestratorMessage[] {
  const known = new Set(input.server.map((message) => message.id));
  const server = input.server.map((message) => input.ran.get(message.id) ?? message);
  return [...server, ...input.sent.filter((message) => !known.has(message.id)).map((message) => input.ran.get(message.id) ?? message)];
}
