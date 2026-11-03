import type { HomeMeetingRow, HomeView, ItemKind, MeetingState } from "@meet-first/contracts";
import { apiFetch, APP_PATHS, pairPathWithCard, routes, usePolledView, type PolledView } from "../../app-shell/index.js";
import type { StickerName } from "../../look/index.js";

// How often the home screen asks again while something on it is still moving (a card being written, a meeting under way), in ms.
export const HOME_POLL_MS = 5_000;

// One link the next step offers: its words and where it goes.
export type StepLink = { label: string; to: string };
// The one next step home shows: a short heading, one line, the main link, an optional second link, and its sticker.
export type NextStep = { title: string; text: string; action: StepLink; second?: StepLink; sticker: StickerName };

// Loads the home view and asks again while a card is being written or a meeting is waiting or running.
export function useHomeView(): PolledView<HomeView> {
  return usePolledView(() => apiFetch(routes.people.readHome, {}), { key: "home", intervalMs: HOME_POLL_MS, keepPolling: isStillMoving });
}

// True while something on the home screen will change by itself.
function isStillMoving(home: HomeView): boolean {
  if (home.source !== null && !home.source.namesPassDone) return true;
  if (home.card?.state === "building") return true;
  return home.meetings.some((meeting) => isUnderWay(meeting.state));
}

// True for a meeting that has not ended: ready, queued or running.
export function isUnderWay(state: MeetingState): boolean {
  return state === "ready" || state === "queued" || state === "running";
}

// The step before a card is approved: add notes, check the names, wait for the card, or approve it.
function stepBeforeApproval(home: HomeView): NextStep | null {
  const { source, card } = home;
  if (source === null) {
    return { title: "Add your notes.", text: "Upload a chat export or paste some of your own messages. Your agent learns how you talk from them.", action: { label: "Add your notes", to: APP_PATHS.upload }, sticker: "phone" };
  }
  if (!source.namesReviewed) {
    const text = source.namesPassDone ? "We found other people's names in your notes. Choose how to hide them before anything is used." : "We are looking for other people's names in your notes. It takes a few seconds.";
    return { title: "Check the names.", text, action: { label: "Check the names", to: APP_PATHS.namesReview(source.id) }, sticker: "lens" };
  }
  if (card === null) return { title: "Your card is next.", text: "Your agent writes your card from your notes once the names are checked.", action: { label: "Check the names", to: APP_PATHS.namesReview(source.id) }, sticker: "lens" };
  if (card.state === "building") return { title: "Your card is being written.", text: "It takes about a minute. Every line comes with the quote it rests on.", action: { label: "Watch it fill in", to: APP_PATHS.card(card.id) }, sticker: "pencil" };
  if (card.state === "failed") return { title: "Your card needs another try.", text: "Writing it failed this time. Your notes are still here.", action: { label: "Open my card", to: APP_PATHS.card(card.id) }, sticker: "pencil" };
  if (card.state === "approved") return null;
  return { title: "Approve your card.", text: "Read what your agent learned and say yes to the lines it may use in a meeting.", action: { label: "Review my card", to: APP_PATHS.card(card.id) }, sticker: "check" };
}

// The step after the card is approved: watch a meeting, read a brief, go back to a waiting pair, or meet someone.
function stepAfterApproval(home: HomeView, cardId: string): NextStep {
  const live = home.meetings.find((meeting) => isUnderWay(meeting.state));
  if (live !== undefined) {
    return { title: "Your meeting is on.", text: `Your agent and ${live.otherDisplayName}'s are talking it through. Watch, or come back for the brief.`, action: { label: "Watch it", to: APP_PATHS.meeting(live.id) }, sticker: "chat" };
  }
  const newest = home.meetings[0];
  if (newest?.isBriefReady === true) {
    return { title: "Your brief is ready.", text: `How you and ${newest.otherDisplayName} would probably get on, every line with its quote.`, action: { label: "Read the brief", to: APP_PATHS.brief(newest.id) }, second: { label: "Meet someone new", to: pairPathWithCard(cardId) }, sticker: "check" };
  }
  const pair = home.pairs[0];
  if (pair !== undefined) {
    const text = pair.otherDisplayName === null ? "Your invite is open. Send the link to the person you want to meet." : `${pair.otherDisplayName} joined. Pick a question and say you are ready.`;
    return { title: pair.otherDisplayName === null ? "Waiting for them to join." : "Pick a question.", text, action: { label: "Open the lobby", to: APP_PATHS.lobby(pair.id) }, sticker: "tags" };
  }
  return { title: "Meet someone.", text: "Your card is approved. Share an invite with a friend, or find someone in Explore.", action: { label: "Pair with someone", to: pairPathWithCard(cardId) }, second: { label: "Open Explore", to: APP_PATHS.explore }, sticker: "tags" };
}

// The one next step for this person, from where they are: notes, names, card, then meetings (design pass fix 4).
export function nextStepOf(home: HomeView): NextStep {
  const before = stepBeforeApproval(home);
  if (before !== null || home.card === null) return before ?? { title: "Add your notes.", text: "", action: { label: "Add your notes", to: APP_PATHS.upload }, sticker: "phone" };
  return stepAfterApproval(home, home.card.id);
}

// The words for where a meeting is, as its row shows them.
export function meetingStateWords(meeting: HomeMeetingRow): string {
  if (meeting.state === "running") return "Talking now";
  if (meeting.state === "queued") return "In the queue";
  if (meeting.state === "ready") return "Waiting to start";
  return meeting.isBriefReady ? "Brief ready" : "Ended";
}

// Where a meeting row leads: the brief once it is written, else the meeting itself.
export function meetingLink(meeting: HomeMeetingRow): string {
  return meeting.isBriefReady ? APP_PATHS.brief(meeting.id) : APP_PATHS.meeting(meeting.id);
}

// The colour class of each kind of card item on the home name tag.
export const ITEM_KIND_COLOUR: Record<ItemKind, string> = { value: "c-green", preference: "c-yellow", habit: "c-lilac", boundary: "c-coral", goal: "c-blue" };

// A short day for a time, against the server's now: Today, Yesterday, or the day and month.
export function shortDay(iso: string, serverNow: string): string {
  const day = (value: string): string => value.slice(0, 10);
  if (day(iso) === day(serverNow)) return "Today";
  const yesterday = new Date(Date.parse(serverNow) - 86_400_000).toISOString();
  if (day(iso) === day(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
}
