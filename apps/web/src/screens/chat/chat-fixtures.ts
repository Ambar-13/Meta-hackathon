// Test data for the chat page, shared by its accessibility tests and its gallery views: messages in every state, a home view with and
// without an approved card, friends, and asks in every state. Every object is checked against its contracts schema.
import { AskView, FriendsView, HomeView, OrchestratorMessage, OrchestratorThread, type AskAnswer, type Friend } from "@meet-first/contracts";

// The time every fixture is stamped with.
export const CHAT_NOW = "2026-11-02T09:00:00.000Z";

// A fixed uuid for this page's test data, by number.
export function chatId(n: number): string {
  return `00000000-0000-4000-8000-${String(7000 + n).padStart(12, "0")}`;
}

// The fixed ids the tests and views use.
export const CHAT_IDS = { card: chatId(1), source: chatId(2), mira: chatId(3), jonah: chatId(4), ask: chatId(5), reply: chatId(6), sent: chatId(7) } as const;

// The person's own message.
export function youSaid(id: string, text: string): OrchestratorMessage {
  return OrchestratorMessage.parse({ id, role: "you", text, state: "done", action: null, actionQuestion: null, actionFriendName: null, askId: null, createdAt: CHAT_NOW });
}

// One orchestrator reply; the fields not given are those of a done reply with no action.
export function replied(id: string, fields: Partial<OrchestratorMessage>): OrchestratorMessage {
  return OrchestratorMessage.parse({ id, role: "agent", text: "", state: "done", action: null, actionQuestion: null, actionFriendName: null, askId: null, createdAt: CHAT_NOW, ...fields });
}

// A thread of these messages, oldest first.
export function threadOf(messages: OrchestratorMessage[]): OrchestratorThread {
  return OrchestratorThread.parse({ messages });
}

// The home view of Ana, with an approved card, or with no card and no notes yet.
export function homeOf(hasCard: boolean): HomeView {
  const card = hasCard ? { id: CHAT_IDS.card, state: "approved", itemCount: 4, items: [] } : null;
  return HomeView.parse({ displayName: "Ana", source: null, card, meetings: [], pairs: [], serverNow: CHAT_NOW });
}

// Mira, with friend asks on.
export const MIRA: Friend = { pairId: CHAT_IDS.mira, displayName: "Mira", canAsk: true, listingId: null };
// Jonah, with friend asks on.
export const JONAH: Friend = { pairId: CHAT_IDS.jonah, displayName: "Jonah", canAsk: true, listingId: null };

// The friends list with these friends.
export function friendsOf(friends: Friend[]): FriendsView {
  return FriendsView.parse({ friends });
}

// One answer of an ask, from this person.
export function answerFrom(n: number, displayName: string, answer: string): AskAnswer {
  return { answerId: chatId(100 + n), displayName, line: null, answer, claims: [], hasSign: true, position: n, canMeet: false };
}

// An ask in one state, with these answers.
export function askOf(fields: Partial<AskView>): AskView {
  return AskView.parse({ askId: CHAT_IDS.ask, mode: "react", text: "How would Mira react if I moved our trip to March?", state: "asking", refusedReason: null, aboutName: "Mira", answers: [], createdAt: CHAT_NOW, ...fields });
}

// The question the planned friend ask carries.
export const TRIP_QUESTION = "How would you feel if we moved our trip to March?";
// The question the planned help search carries.
export const USERS_QUESTION = "Who could help me get my first ten users for a study app?";

// A planned friend ask to Mira.
export function plannedReact(id: string): OrchestratorMessage {
  return replied(id, { state: "planned", action: "react", text: "I can ask Mira's agent how she would probably take a March trip.", actionQuestion: TRIP_QUESTION, actionFriendName: "Mira" });
}

// A planned help search.
export function plannedHelp(id: string): OrchestratorMessage {
  return replied(id, { state: "planned", action: "help", text: "I can ask the agents of people in Explore who could probably help.", actionQuestion: USERS_QUESTION });
}
