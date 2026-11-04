import { CommittedEvent, type Claim } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { MeetingScreen } from "../../../screens/meeting/index.js";
import type { FeedStatus, MeetingFeed, MeetingFeedOptions } from "../../../streaming/index.js";
import { emptyMeetingState, foldEvent, type MeetingFoldState } from "../../../transcript/index.js";
import { IDS, meetingView, SERVER_NOW } from "../../fixtures.js";
import type { GalleryView } from "../gallery-views.js";

// The meeting page in each of its states, with two named people and a feed that sends one folded state when it opens.

const QUESTION = "Would we enjoy a 10-day hackathon together?";
const MEMBERS = [
  { side: "a" as const, displayName: "Mira", ready: true, connected: true },
  { side: "b" as const, displayName: "Jonah", ready: true, connected: false },
];

// The fields every committed event of the sample meeting carries.
function base(seq: number): { v: 1; meetingId: string; at: string; seq: number } {
  return { v: 1, meetingId: IDS.meeting, at: SERVER_NOW, seq };
}

// One claim of the sample, on either side, verified or not.
function claim(slot: { side: "a" | "b"; quote: string; isVerified: boolean; n: number }): Claim {
  return {
    id: `00000000-0000-4000-8000-0000000000${String(10 + slot.n)}`,
    side: slot.side,
    position: 1,
    text: slot.quote,
    quote: slot.quote,
    lang: "en",
    turnId: slot.side === "a" ? IDS.turnA : "00000000-0000-4000-8000-000000000302",
    verified: slot.isVerified,
    flagged: !slot.isVerified,
    evidenceValid: slot.isVerified,
  };
}

// The sample meeting's events: started, the explore phase, then three turns with their quotes.
const EVENTS: readonly CommittedEvent[] = [
  CommittedEvent.parse({
    ...base(1),
    type: "meeting.started",
    startedAt: SERVER_NOW,
    endsAt: "2026-10-27T10:10:00.000Z",
    question: QUESTION,
    members: [
      { side: "a", displayName: "Mira" },
      { side: "b", displayName: "Jonah" },
    ],
  }),
  CommittedEvent.parse({ ...base(2), type: "phase.changed", phase: "explore", stepSeq: 1 }),
  CommittedEvent.parse({
    ...base(3),
    type: "turn.committed",
    stepSeq: 1,
    side: "a",
    phase: "explore",
    text: "Mira would probably want a plan before the first commit. She hates guessing what done looks like.",
    claims: [
      claim({
        side: "a",
        quote: "I can't start until I know what done looks like.",
        isVerified: true,
        n: 1,
      }),
    ],
  }),
  CommittedEvent.parse({
    ...base(4),
    type: "turn.committed",
    stepSeq: 2,
    side: "b",
    phase: "explore",
    text: "Jonah would probably start building before the plan is done. He thinks out loud in code.",
    claims: [
      claim({ side: "b", quote: "Easier to show you than to explain it.", isVerified: true, n: 2 }),
    ],
  }),
  CommittedEvent.parse({
    ...base(5),
    type: "turn.committed",
    stepSeq: 3,
    side: "b",
    phase: "explore",
    text: "He would probably take the pitch, and enjoy it.",
    claims: [claim({ side: "b", quote: "Give me the mic any day.", isVerified: false, n: 3 })],
  }),
];
const ENDED = CommittedEvent.parse({
  ...base(6),
  type: "meeting.ended",
  reason: "decided",
  endedAt: "2026-10-27T10:09:00.000Z",
});
const BRIEF_READY = CommittedEvent.parse({
  ...base(7),
  type: "brief.ready",
  supportRate: { a: 1, b: 0.889 },
});

// The events folded in order from an empty meeting.
function fold(events: readonly CommittedEvent[]): MeetingFoldState {
  return events.reduce((state, event) => foldEvent(state, event), emptyMeetingState(IDS.meeting));
}

// A feed that sends one state, with one status, a moment after it opens.
function feedOf(
  state: MeetingFoldState,
  status: FeedStatus,
): (options: MeetingFeedOptions) => MeetingFeed {
  return (options) => {
    const timer = setTimeout(() => {
      options.onState(state, status);
    }, 60);
    return {
      close: () => {
        clearTimeout(timer);
      },
      currentState: () => state,
      currentStatus: () => status,
    };
  };
}

const LIVE = {
  ...fold(EVENTS),
  partial: {
    stepSeq: 4,
    attempt: 1,
    side: "a" as const,
    text: "Then she would probably hand him the pitch. She'd rather",
  },
};
const RUNNING = meetingView({
  state: "running",
  startedAt: SERVER_NOW,
  endsAt: "2026-10-27T10:10:00.000Z",
  questionText: QUESTION,
  members: MEMBERS,
});

// One meeting view on the meeting route.
function meetingAt(slot: {
  name: string;
  title: string;
  view: ReturnType<typeof meetingView> | null;
  feed: (options: MeetingFeedOptions) => MeetingFeed;
}): GalleryView {
  return {
    name: slot.name,
    title: slot.title,
    pattern: ROUTE_PATTERNS.meeting,
    url: APP_PATHS.meeting(IDS.meeting),
    element: <MeetingScreen openFeed={slot.feed} />,
    stubs:
      slot.view === null
        ? []
        : [{ route: routes.meetings.readMeeting, replies: { status: 200, body: slot.view } }],
  };
}

// The meeting page: waiting, queued, live with a turn being written, slow network, ended while the brief is written, ended with
// the brief ready, and a meeting that could not be loaded.
export const views: readonly GalleryView[] = [
  meetingAt({
    name: "meeting-waiting",
    title: "Meeting, waiting to start",
    view: meetingView({ questionText: QUESTION, members: MEMBERS }),
    feed: feedOf(fold([]), "connecting"),
  }),
  meetingAt({
    name: "meeting-queued",
    title: "Meeting, queued",
    view: meetingView({
      state: "queued",
      queuePosition: 2,
      questionText: QUESTION,
      members: MEMBERS,
    }),
    feed: feedOf(fold([]), "connecting"),
  }),
  meetingAt({
    name: "meeting-live",
    title: "Meeting, live with a turn being written",
    view: RUNNING,
    feed: feedOf(LIVE, "live"),
  }),
  meetingAt({
    name: "meeting-slow",
    title: "Meeting, live on a slow network",
    view: RUNNING,
    feed: feedOf(fold(EVENTS), "polling"),
  }),
  meetingAt({
    name: "meeting-ended-writing",
    title: "Meeting, ended while the brief is written",
    view: { ...RUNNING, state: "ended" },
    feed: feedOf(fold([...EVENTS, ENDED]), "live"),
  }),
  meetingAt({
    name: "meeting-ended",
    title: "Meeting, ended with the brief ready",
    view: { ...RUNNING, state: "ended" },
    feed: feedOf(fold([...EVENTS, ENDED, BRIEF_READY]), "live"),
  }),
  meetingAt({
    name: "meeting-error",
    title: "Meeting, could not be loaded",
    view: null,
    feed: feedOf(fold([]), "connecting"),
  }),
];
