import { useEffect, type ReactElement } from "react";
import { AsksView, FriendRequestsView, FriendsView, type AboutMeAnswer, type AnswerClaim, type AskSummary, type Friend } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { FriendsScreen } from "../../../screens/friends/index.js";
import { SERVER_NOW } from "../../fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// One scripted step on a gallery view: press the last button with these words, or type text into the first text box.
export type GalleryStep = { click: string } | { type: string };

// How often the script looks for the next step's control, in ms.
const STEP_POLL_MS = 120;

// Types into a React text box: sets the value through the native setter, then sends the input event React listens to.
function typeInto(field: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

// Runs one step if its control is on the page; returns true when it ran.
function runStep(step: GalleryStep): boolean {
  if ("type" in step) {
    const field = document.querySelector("textarea");
    if (field === null) return false;
    typeInto(field, step.type);
    return true;
  }
  const button = Array.from(document.querySelectorAll("button")).filter((candidate) => candidate.textContent === step.click).at(-1);
  if (button === undefined) return false;
  button.click();
  return true;
}

// Renders a screen, then plays the steps in order as their controls appear, so a view can show a state a person reaches by acting.
export const ScriptedSteps = (props: { steps: readonly GalleryStep[]; children: ReactElement }): ReactElement => {
  useEffect(() => {
    let next = 0;
    const timer = setInterval(() => {
      const step = props.steps[next];
      if (step === undefined) {
        clearInterval(timer);
        return;
      }
      if (runStep(step)) next += 1;
    }, STEP_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [props.steps]);
  return props.children;
};

// The gallery's fixed ids for this page.
const ID = (n: number): string => `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;
// Friends: two with friend asks on, one with them off, and one with a long name.
const FRIENDS: Friend[] = [
  { pairId: ID(1), displayName: "Bea", canAsk: true, listingId: ID(41) },
  { pairId: ID(2), displayName: "Cal", canAsk: false, listingId: null },
  { pairId: ID(3), displayName: "Jonah", canAsk: true, listingId: null },
  { pairId: ID(4), displayName: "Maximiliana", canAsk: false, listingId: null },
];
// One claim of each kind: backed, weak, and with no receipt.
const BACKED: AnswerClaim = { text: "Says yes, then plans", quote: "I say yes first and plan the details after.", verified: true, supported: true };
const WEAK: AnswerClaim = { text: "Likes a backup plan", quote: "I always keep a plan B in my notes.", verified: true, supported: false };
const MISSING: AnswerClaim = { text: "Reads the logs first", quote: "I read the logs first.", verified: false, supported: null };
// Two answers the caller's persona gave.
const COPIES: AboutMeAnswer[] = [
  { answerId: ID(11), mode: "react", text: "Being asked to lead the demo at the last minute.", askerName: "Ola", answer: "My person would probably say yes, then ask for notes.", claims: [BACKED, WEAK], createdAt: SERVER_NOW },
  { answerId: ID(12), mode: "help", text: "Our deploys fail at night and nobody knows why.", askerName: "Pim", answer: "My person would probably read the logs first.", claims: [MISSING], createdAt: SERVER_NOW },
];
// Three asks the caller sent, in three states.
const SENT: AskSummary[] = [
  { askId: ID(21), mode: "react", text: "Being asked to pitch with no slides.", state: "done", createdAt: SERVER_NOW },
  { askId: ID(22), mode: "help", text: "My React app leaks memory after an hour.", state: "asking", createdAt: SERVER_NOW },
  { askId: ID(23), mode: "help", text: "Who would rate my startup idea?", state: "refused", createdAt: SERVER_NOW },
];

// Two requests to answer and one sent, as GET /api/friend-requests returns them.
const REQUESTS = FriendRequestsView.parse({
  incoming: [
    { requestId: ID(31), direction: "incoming", otherName: "Ines", otherListingId: ID(42), createdAt: SERVER_NOW },
    { requestId: ID(32), direction: "incoming", otherName: "Kofi", otherListingId: null, createdAt: SERVER_NOW },
  ],
  outgoing: [{ requestId: ID(33), direction: "outgoing", otherName: "Lena", otherListingId: null, createdAt: SERVER_NOW }],
});
// No pending requests either way.
const NO_REQUESTS = FriendRequestsView.parse({ incoming: [], outgoing: [] });

// The three reads of the page with these friends, these asks and these requests.
function readStubs(friends: Friend[], asks: { asked: AskSummary[]; aboutMe: AboutMeAnswer[] }, requests: FriendRequestsView = NO_REQUESTS): GalleryStub[] {
  return [
    { route: routes.directory.friends, replies: { status: 200, body: FriendsView.parse({ friends }) } },
    { route: routes.asks.listAsks, replies: { status: 200, body: AsksView.parse(asks) } },
    { route: routes.social.listFriendRequests, replies: { status: 200, body: requests } },
  ];
}

// The full page's reads, used by most views.
const FULL = readStubs(FRIENDS, { asked: SENT, aboutMe: COPIES });
// The ask text the scripted views type.
const ASK_TEXT = "Being asked to lead the demo at the last minute.";

// One view of the friends page on its route.
function friendsView(head: { name: string; title: string }, stubs: GalleryStub[], steps: readonly GalleryStep[] = []): GalleryView {
  return { ...head, pattern: ROUTE_PATTERNS.friends, url: "/friends", element: <ScriptedSteps steps={steps}><FriendsScreen /></ScriptedSteps>, stubs };
}

// The friends page: requests to answer, the list with each friend's switch, the open ask box and its errors, the answers your persona
// gave, the asks you sent, and the loading, empty and error states.
export const views: readonly GalleryView[] = [
  friendsView({ name: "friends-requests", title: "Friends, requests to answer, friends and requests sent" }, readStubs(FRIENDS, { asked: SENT, aboutMe: COPIES }, REQUESTS)),
  friendsView({ name: "friends-list", title: "Friends, the list with answers and sent asks" }, FULL),
  friendsView({ name: "friends-ask-open", title: "Friends, the ask box open with a question" }, FULL, [{ click: "Ask their agent" }, { type: ASK_TEXT }]),
  friendsView({ name: "friends-ask-too-short", title: "Friends, a question that is too short" }, FULL, [{ click: "Ask their agent" }, { type: "Hm" }, { click: "Send the ask" }]),
  friendsView({ name: "friends-ask-sending", title: "Friends, the ask being sent" }, [...FULL, { route: routes.asks.createAsk, replies: { status: 201, body: { askId: ID(30) }, delayMs: FOREVER_MS } }], [{ click: "Ask their agent" }, { type: ASK_TEXT }, { click: "Send the ask" }]),
  friendsView({ name: "friends-ask-refused", title: "Friends, the ask refused because asks are off" }, [...FULL, { route: routes.asks.createAsk, replies: { status: 409, body: { code: "friend_asks_off", message: "Jonah has not turned on friend asks." } } }], [{ click: "Ask their agent" }, { type: ASK_TEXT }, { click: "Send the ask" }]),
  friendsView({ name: "friends-empty", title: "Friends, nobody yet and nothing asked" }, readStubs([], { asked: [], aboutMe: [] })),
  friendsView({ name: "friends-loading", title: "Friends, both lists loading" }, [
    { route: routes.directory.friends, replies: { status: 200, body: { friends: [] }, delayMs: FOREVER_MS } },
    { route: routes.asks.listAsks, replies: { status: 200, body: { asked: [], aboutMe: [] }, delayMs: FOREVER_MS } },
    { route: routes.social.listFriendRequests, replies: { status: 200, body: NO_REQUESTS, delayMs: FOREVER_MS } },
  ]),
  friendsView({ name: "friends-error", title: "Friends, both lists failed to load" }, []),
];
