import { Brief, ShareSnapshot, type BriefPoint } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { ConsentScreen, PublicSharePage } from "../../../screens/share/index.js";
import { IDS, meetingView } from "../../fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { AfterSteps } from "./help.js";

// The slug of the gallery's share page.
const SLUG = "AAAAAAAAAAAAAAAAAAAAAA";
// The question of the gallery meeting.
const QUESTION = "Would we enjoy a 10-day hackathon together?";
// A failed reply from the server, as the error states show it.
const SERVER_ERROR = { status: 500, body: { code: "server_error", message: "Something went wrong on our side. Try again in a minute." } };
// The two people of the gallery meeting.
const MEMBERS = [
  { side: "a", displayName: "Mira", ready: true, connected: false },
  { side: "b", displayName: "Jonah", ready: true, connected: false },
] as const;

// One brief line on side a's or b's quote; supported says whether the support check backed it.
function point(text: string, quote: { text: string; side: "a" | "b" }, supported: boolean | null): BriefPoint {
  return { text, quotes: [{ ...quote, turnId: IDS.turnA, verified: true }], supported };
}

// A brief of the gallery meeting: some lines passed the support check and some did not.
function briefFixture(isAllWeak: boolean): Brief {
  const isBacked = !isAllWeak;
  return Brief.parse({
    agree: [
      point("Mira plans, Jonah builds, and neither wants the other's job.", { text: "I can't start until I know what done looks like.", side: "a" }, isBacked),
      point("Both would rather demo something small that works.", { text: "Easier to show you than to explain it.", side: "b" }, isBacked),
      point("Both like a quiet room in the morning.", { text: "Mornings are for heads down.", side: "a" }, false),
    ],
    clash: [
      point("He ships at 3 am. She is done by 9 pm.", { text: "Best code happens after midnight.", side: "b" }, isBacked),
      point("They would probably argue about the pitch.", { text: "I hate pitching.", side: "a" }, null),
      point("Different views on tests.", { text: "Tests can wait.", side: "b" }, false),
    ],
    decideFirst: [
      point("Who has the final say on scope.", { text: "Someone has to say no to features.", side: "a" }, isBacked),
      point("When the team stops for the day.", { text: "I need to sleep at some point.", side: "a" }, false),
      point("Who gives the pitch.", { text: "I'd take the pitch, happily.", side: "b" }, false),
    ],
    supportRate: 0.6,
    supportReliable: true,
    questionKind: "get_along",
  });
}

// The stubs of a consent screen on an ended meeting, with the brief reply given.
function consentStubs(brief: GalleryStub["replies"]): GalleryStub[] {
  return [
    { route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({ state: "ended", questionText: QUESTION, members: [...MEMBERS] }) } },
    { route: routes.briefs.readBrief, replies: brief },
  ];
}

// The public snapshot of the gallery meeting.
function snapshotFixture(): ShareSnapshot {
  return ShareSnapshot.parse({
    question: QUESTION,
    questionKind: "get_along",
    people: [
      { side: "a", displayName: "Mira" },
      { side: "b", displayName: "Jonah" },
    ],
    items: [
      { side: "a", kind: "habit", claim: "Writes the plan before the first commit", quote: "I can't start until I know what done looks like." },
      { side: "a", kind: "boundary", claim: "Done by 9 pm", quote: "After nine I am no use to anyone." },
      { side: "b", kind: "preference", claim: "Builds to find out", quote: "Easier to show you than to explain it." },
    ],
    turns: [
      { side: "a", text: "Mira would probably want a plan before the first commit. She hates guessing what **done** looks like.", claims: [{ text: "Writes the plan first", quote: "I can't start until I know what done looks like." }] },
      { side: "b", text: "Jonah would probably start building before the plan is done.", claims: [{ text: "Builds to find out", quote: "Easier to show you than to explain it." }] },
      { side: "a", text: "Then the first evening is for the plan, and the build starts the next morning.", claims: [] },
      { side: "b", text: "He'd take the pitch, probably happily.", claims: [] },
    ],
    brief: {
      agree: [
        { text: "Mira plans, Jonah builds, and neither wants the other's job.", quotes: [{ text: "I can't start until I know what done looks like.", side: "a" }] },
        { text: "Both would rather demo something small that works.", quotes: [{ text: "Easier to show you than to explain it.", side: "b" }] },
      ],
      clash: [{ text: "He ships at 3 am. She is done by 9 pm.", quotes: [{ text: "Best code happens after midnight.", side: "b" }, { text: "After nine I am no use to anyone.", side: "a" }] }],
      decideFirst: [],
    },
  });
}

// The consent screen in every state, then the public page in every state.
export const views: readonly GalleryView[] = [
  { name: "consent-ready", title: "Consent, the preview and the consent button", pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting), element: <ConsentScreen />, stubs: consentStubs({ status: 200, body: briefFixture(false) }) },
  { name: "consent-preview-loading", title: "Consent, the preview still reading the brief", pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting), element: <ConsentScreen />, stubs: consentStubs({ status: 200, body: briefFixture(false), delayMs: FOREVER_MS }) },
  { name: "consent-no-lines", title: "Consent, no brief line passed the check", pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting), element: <ConsentScreen />, stubs: consentStubs({ status: 200, body: briefFixture(true) }) },
  { name: "consent-brief-error", title: "Consent, the brief could not be read", pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting), element: <ConsentScreen />, stubs: consentStubs(SERVER_ERROR) },
  {
    name: "consent-waiting",
    title: "Consent, waiting for the other person",
    pattern: ROUTE_PATTERNS.consent,
    url: APP_PATHS.consent(IDS.meeting),
    element: <AfterSteps steps={[{ press: "I consent to publish" }]}><ConsentScreen /></AfterSteps>,
    stubs: [...consentStubs({ status: 200, body: briefFixture(false) }), { route: routes.briefs.consent, replies: { status: 200, body: { consentA: true, consentB: false, published: false } } }],
  },
  {
    name: "consent-published",
    title: "Consent, the page is live",
    pattern: ROUTE_PATTERNS.consent,
    url: APP_PATHS.consent(IDS.meeting),
    element: <AfterSteps steps={[{ press: "I consent to publish" }]}><ConsentScreen /></AfterSteps>,
    stubs: [...consentStubs({ status: 200, body: briefFixture(false) }), { route: routes.briefs.consent, replies: { status: 200, body: { consentA: true, consentB: true, published: true, slug: SLUG } } }],
  },
  {
    name: "consent-closed",
    title: "Consent, closed until both briefs are written",
    pattern: ROUTE_PATTERNS.consent,
    url: APP_PATHS.consent(IDS.meeting),
    element: <ConsentScreen />,
    stubs: [{ route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({ state: "running", questionText: QUESTION, members: [...MEMBERS] }) } }],
  },
  { name: "consent-loading", title: "Consent, reading the meeting", pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting), element: <ConsentScreen />, stubs: [{ route: routes.meetings.readMeeting, replies: { status: 200, body: meetingView({}), delayMs: FOREVER_MS } }] },
  { name: "consent-error", title: "Consent, the meeting could not be read", pattern: ROUTE_PATTERNS.consent, url: APP_PATHS.consent(IDS.meeting), element: <ConsentScreen />, stubs: [{ route: routes.meetings.readMeeting, replies: SERVER_ERROR }] },
  { name: "share-ready", title: "Public share page", pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG), element: <PublicSharePage />, stubs: [{ route: routes.briefs.readShare, replies: { status: 200, body: snapshotFixture() } }] },
  { name: "share-loading", title: "Public share page, loading", pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG), element: <PublicSharePage />, stubs: [{ route: routes.briefs.readShare, replies: { status: 200, body: snapshotFixture(), delayMs: FOREVER_MS } }] },
  { name: "share-not-found", title: "Public share page, taken down", pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG), element: <PublicSharePage /> },
  { name: "share-error", title: "Public share page, the server failed", pattern: ROUTE_PATTERNS.sharePage, url: APP_PATHS.sharePage(SLUG), element: <PublicSharePage />, stubs: [{ route: routes.briefs.readShare, replies: SERVER_ERROR }] },
];
