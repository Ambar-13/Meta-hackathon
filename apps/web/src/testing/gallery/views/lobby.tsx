import { CURATED_QUESTIONS, type PairMeetingRow } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { LobbyScreen } from "../../../screens/lobby/index.js";
import { IDS, meetingView, pairView, SERVER_NOW } from "../../fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// The lobby with an approved card in its address.
const LOBBY_URL = `${APP_PATHS.lobby(IDS.pair)}?card=${IDS.card}`;
// The question the meeting fixtures use.
const QUESTION = CURATED_QUESTIONS[2]?.text ?? "";
// Meeting rows in each state the list shows.
const READY_ROW: PairMeetingRow = { id: IDS.meeting, state: "ready", questionText: QUESTION, createdAt: SERVER_NOW };
const QUEUED_ROW: PairMeetingRow = { ...READY_ROW, state: "queued", queuePosition: 2 };
const ENDED_ROWS: PairMeetingRow[] = [
  { id: "00000000-0000-4000-8000-000000000202", state: "ended", questionText: "Would we make a deal on how to split a hackathon prize?", createdAt: "2026-10-27T09:00:00.000Z" },
  { id: "00000000-0000-4000-8000-000000000203", state: "ended", questionText: "Would we enjoy a first date, and what would we talk about?", createdAt: "2026-10-27T08:00:00.000Z" },
];
// Two named people, so the tags read like the probe.
const MEMBERS_WAITING = [
  { side: "a" as const, displayName: "Mira", ready: true, connected: true },
  { side: "b" as const, displayName: "Jonah", ready: false, connected: false },
];
const MEMBERS_VIEWER_WAITING = [
  { side: "a" as const, displayName: "Mira", ready: false, connected: true },
  { side: "b" as const, displayName: "Jonah", ready: true, connected: true },
];
const MEMBERS_BOTH = [
  { side: "a" as const, displayName: "Mira", ready: true, connected: true },
  { side: "b" as const, displayName: "Jonah", ready: true, connected: true },
];

// The pair read with Mira and Jonah, holding the given rows.
function pairWith(meetings: PairMeetingRow[], hasJoiner = true): GalleryStub {
  const base = pairView({ hasJoiner, meetings });
  const named = { ...base, creator: { displayName: "Mira" }, ...(hasJoiner ? { joiner: { displayName: "Jonah" } } : {}) };
  return { route: routes.meetings.readPair, replies: { status: 200, body: named } };
}

// One lobby view on the lobby route, with the card in its address.
function lobby(name: string, title: string, stubs: readonly GalleryStub[]): GalleryView {
  return { name, title, pattern: ROUTE_PATTERNS.lobby, url: LOBBY_URL, element: <LobbyScreen />, stubs };
}

// The lobby in each of its states: loading, error, waiting, expired, picking, ready, queued, starting, and with past meetings.
export const views: readonly GalleryView[] = [
  lobby("lobby-loading", "Lobby, loading", [{ route: routes.meetings.readPair, replies: { status: 200, body: pairView({ hasJoiner: true, meetings: [] }), delayMs: FOREVER_MS } }]),
  lobby("lobby-error", "Lobby, the pair could not be read", []),
  lobby("lobby-waiting", "Lobby, waiting for the other person", [pairWith([], false)]),
  lobby("lobby-expired", "Lobby, the invite expired", [
    { route: routes.meetings.readPair, replies: { status: 200, body: { ...pairView({ hasJoiner: false, meetings: [] }), creator: { displayName: "Mira" }, serverNow: "2026-10-29T10:00:00.000Z" } } },
  ]),
  lobby("lobby-pick", "Lobby, picking a question", [pairWith([])]),
  { ...lobby("lobby-no-card", "Lobby, no approved card on this phone", [pairWith([])]), url: APP_PATHS.lobby(IDS.pair) },
  lobby("lobby-ready", "Lobby, waiting for the other person to say ready", [
    pairWith([READY_ROW]),
    { route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({ members: MEMBERS_WAITING }) } },
  ]),
  lobby("lobby-ready-you", "Lobby, your turn to say ready", [
    pairWith([READY_ROW]),
    { route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({ members: MEMBERS_VIEWER_WAITING, questionChecked: false }) } },
  ]),
  lobby("lobby-queued", "Lobby, in the queue", [
    pairWith([QUEUED_ROW]),
    { route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({ state: "queued", queuePosition: 2, members: MEMBERS_BOTH }) } },
  ]),
  lobby("lobby-starting", "Lobby, both ready and starting", [
    pairWith([READY_ROW]),
    { route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({ members: MEMBERS_BOTH, questionKind: "romance" }) } },
  ]),
  lobby("lobby-meeting-loading", "Lobby, loading the next meeting", [
    pairWith([READY_ROW]),
    { route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({}), delayMs: FOREVER_MS } },
  ]),
  lobby("lobby-past", "Lobby, with past meetings", [pairWith(ENDED_ROWS)]),
];
