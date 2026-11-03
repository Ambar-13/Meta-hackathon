import type { OrchestratorMessage } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { ChatScreen } from "../../../screens/chat/index.js";
import {
  answerFrom,
  askOf,
  CHAT_IDS,
  chatId,
  friendsOf,
  homeOf,
  JONAH,
  MIRA,
  plannedHelp,
  plannedReact,
  replied,
  threadOf,
  TRIP_QUESTION,
  USERS_QUESTION,
  youSaid,
} from "../../../screens/chat/chat-fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { ScriptedSteps, type GalleryStep } from "./friends.js";

// The person's messages the views use.
const ASK_TRIP = "How would Mira react if I moved our trip to March?";
const ASK_USERS = "Who could help me get my first ten users for my study app?";
// The answers of a finished help search.
const ANSWERS = [
  answerFrom(1, "Bea", "Bea would probably start with a waitlist and a short demo video for her class group chats, then ask the first ten people to bring one friend each. She did that twice."),
  answerFrom(2, "Cal", "Cal would probably post in student groups first. He says the first users come from people who already know you."),
  answerFrom(3, "Dee", "Dee would probably try a small paid test."),
  answerFrom(4, "Eli", "Eli would probably wait."),
];

// A running reply with its ask, and the same reply once the ask is read.
const RUNNING_HELP = replied(chatId(20), { state: "running", action: "help", text: "I started a help search. The answers fill in below as the agents reply.", actionQuestion: USERS_QUESTION, askId: CHAT_IDS.ask });
// A done reply whose run was refused, with the refusal after a blank line.
const REFUSED = replied(chatId(21), { state: "done", action: "react", actionFriendName: "Jonah", actionQuestion: "How would you feel about a later demo slot?", text: "I can ask Jonah's agent how he would probably take a later demo slot.\n\nJonah has not turned on friend asks yet." });
// A failed reply, in the api's words.
const FAILED = replied(chatId(22), { state: "failed", text: "I could not work that out just now. Try again in a minute." });
// A plain answer in words, with a line break.
const WORDS = replied(chatId(23), { state: "done", action: "reply", text: "Meet First lets your agent answer for you from what you chose to share.\nAsk me who could help with something, or how a friend would probably react." });

// The first page of Explore the right-hand column suggests people from: three people who are not friends yet, two of them sample
// people as on the live site.
const SUGGESTED = {
  listings: [
    { listingId: chatId(60), displayName: "Priyanka", line: "Design and front end, happy to pair on anything with a screen.", openToRomance: false, isSample: false, items: [] },
    { listingId: chatId(61), displayName: "Maya", line: "Angel investor. I back small teams early and answer every founder within a week.", openToRomance: false, isSample: true, items: [] },
    { listingId: chatId(62), displayName: "Jun", line: "First hackathon. I build small robots and I am here to meet people.", openToRomance: false, isSample: true, items: [] },
  ],
  page: 0,
  hasMore: false,
};

// The three reads of the page: the thread, the home view and the friends list, plus any other stubs.
function reads(thread: OrchestratorMessage[], extra: GalleryStub[] = [], hasCard = true): GalleryStub[] {
  return [
    { route: routes.social.readThread, replies: { status: 200, body: threadOf(thread) } },
    { route: routes.people.readHome, replies: { status: 200, body: homeOf(hasCard) } },
    { route: routes.directory.friends, replies: { status: 200, body: friendsOf([MIRA, JONAH]) } },
    { route: routes.directory.browse, replies: { status: 200, body: SUGGESTED } },
    ...extra,
  ];
}

// The ask read, in one state.
function askStub(fields: Parameters<typeof askOf>[0]): GalleryStub {
  return { route: routes.asks.readAsk, replies: { status: 200, body: askOf(fields) } };
}

// One view of the chat page at /home.
function chatView(head: { name: string; title: string }, stubs: GalleryStub[], steps: readonly GalleryStep[] = []): GalleryView {
  return { ...head, pattern: ROUTE_PATTERNS.meety, url: "/meety", element: <ScriptedSteps steps={steps}><ChatScreen /></ScriptedSteps>, stubs };
}

// Twelve messages with every kind of reply: words, an answered help search, a planned friend ask, a refusal, a failure and a thinking one.
const LONG_THREAD: OrchestratorMessage[] = [
  youSaid(chatId(30), "What is this page for?"), WORDS,
  youSaid(chatId(31), ASK_USERS), RUNNING_HELP,
  youSaid(chatId(32), ASK_TRIP), plannedReact(chatId(24)),
  youSaid(chatId(33), "How would Jonah feel about a later demo slot?"), REFUSED,
  youSaid(chatId(34), "Who would like my robotics club idea?"), FAILED,
  youSaid(chatId(35), "Who could teach me to pitch in two minutes?\nI have a demo on Friday."), replied(chatId(25), { state: "thinking" }),
];

// The chat page: the empty thread with and without a card, each kind of reply, the daily cap, and the loading and error states.
export const views: readonly GalleryView[] = [
  chatView({ name: "chat-empty", title: "Chat, the empty thread with the greeting and chips" }, reads([])),
  chatView({ name: "chat-empty-no-card", title: "Chat, the empty thread before the card is approved" }, reads([], [], false)),
  chatView({ name: "chat-thinking", title: "Chat, a reply working out what to do" }, reads([youSaid(chatId(40), ASK_TRIP), replied(chatId(41), { state: "thinking" })])),
  chatView({ name: "chat-planned-help", title: "Chat, a planned help search" }, reads([youSaid(chatId(40), ASK_USERS), plannedHelp(chatId(41))])),
  chatView({ name: "chat-planned-react", title: "Chat, a planned friend ask to Mira" }, reads([youSaid(chatId(40), ASK_TRIP), plannedReact(chatId(41))])),
  chatView({ name: "chat-running", title: "Chat, a friend ask with the agents answering" }, reads([youSaid(chatId(40), ASK_TRIP), replied(chatId(41), { state: "running", action: "react", actionFriendName: "Mira", actionQuestion: TRIP_QUESTION, text: "I asked Mira's agent. Its answer fills in below.", askId: CHAT_IDS.ask })], [askStub({ state: "asking" })])),
  chatView({ name: "chat-answered", title: "Chat, a help search with its answers" }, reads([youSaid(chatId(40), ASK_USERS), RUNNING_HELP], [askStub({ mode: "help", aboutName: null, text: USERS_QUESTION, state: "done", answers: ANSWERS })])),
  chatView({ name: "chat-refused", title: "Chat, a friend ask refused because asks are off" }, reads([youSaid(chatId(40), "How would Jonah feel about a later demo slot?"), REFUSED])),
  chatView({ name: "chat-failed", title: "Chat, a reply that could not be worked out" }, reads([youSaid(chatId(40), "Who would like my robotics club idea?"), FAILED])),
  chatView({ name: "chat-cap", title: "Chat, the daily cap reached on send" }, reads([], [{ route: routes.social.sendToOrchestrator, replies: { status: 429, body: { code: "orchestrator_daily_cap", message: "You have sent today's messages to the orchestrator. Try again tomorrow." } } }]), [{ type: "One more question about my demo" }, { click: "Send" }]),
  chatView({ name: "chat-loading", title: "Chat, the thread loading" }, [{ route: routes.social.readThread, replies: { status: 200, body: { messages: [] }, delayMs: FOREVER_MS } }, ...reads([]).slice(1)]),
  chatView({ name: "chat-error", title: "Chat, the thread failed to load" }, reads([]).slice(1)),
  chatView({ name: "chat-long-thread", title: "Chat, a long thread with every kind of reply" }, reads(LONG_THREAD, [askStub({ mode: "help", aboutName: null, text: USERS_QUESTION, state: "done", answers: ANSWERS })])),
];
