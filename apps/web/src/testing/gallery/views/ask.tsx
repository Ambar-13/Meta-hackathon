import { AskView, type AnswerClaim, type AskAnswer } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { AskScreen } from "../../../screens/ask/index.js";
import { IDS, SERVER_NOW } from "../../fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// The gallery's fixed ids for this page.
const ID = (n: number): string => `00000000-0000-4000-8000-${String(950 + n).padStart(12, "0")}`;
const ASK = ID(1);
// One claim of each receipt kind.
const BACKED: AnswerClaim = {
  text: "Reads the logs before guessing",
  quote: "I always read the logs before I guess at a cause.",
  verified: true,
  supported: true,
};
const WEAK: AnswerClaim = {
  text: "Likes night shifts",
  quote: "Night shifts are when I think best.",
  verified: true,
  supported: false,
};
const MISSING: AnswerClaim = {
  text: "Has led a large team",
  quote: "I led a large team once.",
  verified: false,
  supported: null,
};

// One help answer.
function helpAnswer(
  n: number,
  spec: { name: string; line: string; isPlaced: boolean; claims: AnswerClaim[] },
): AskAnswer {
  return {
    answerId: ID(10 + n),
    displayName: spec.name,
    line: spec.line,
    answer: `${spec.name}'s persona would probably read the logs first, then try one small change at a time.`,
    claims: spec.claims,
    hasSign: spec.isPlaced,
    position: spec.isPlaced ? n : null,
    canMeet: spec.isPlaced,
  };
}

// A finished help search: two placed answers, two with no clear sign.
const HELP_ANSWERS: AskAnswer[] = [
  helpAnswer(1, { name: "Mira", line: "I fix flaky deploys.", isPlaced: true, claims: [BACKED] }),
  helpAnswer(2, { name: "Dev", line: "I keep servers calm.", isPlaced: true, claims: [WEAK] }),
  helpAnswer(3, { name: "Sol", line: "I like quiet tools.", isPlaced: false, claims: [MISSING] }),
  helpAnswer(4, { name: "Ana", line: "I teach testing.", isPlaced: false, claims: [] }),
];

// The ask with the given fields replaced: a help search for night deploys.
function askView(overrides: Partial<AskView>): AskView {
  return AskView.parse({
    askId: ASK,
    mode: "help",
    text: "Our deploys fail at night and nobody knows why.",
    state: "done",
    refusedReason: null,
    aboutName: null,
    answers: [],
    createdAt: SERVER_NOW,
    ...overrides,
  });
}

// A friend ask about Bea, with the given fields replaced.
function reactView(overrides: Partial<AskView>): AskView {
  const answer: AskAnswer = {
    answerId: ID(20),
    displayName: "Bea",
    line: null,
    answer:
      "Bea would probably say yes, then ask who owns the slides. She likes a backup plan before she agrees.",
    claims: [BACKED, WEAK],
    hasSign: true,
    position: null,
    canMeet: false,
  };
  return askView({
    mode: "react",
    text: "Being asked to lead the demo at the last minute.",
    aboutName: "Bea",
    answers: [answer],
    ...overrides,
  });
}

// One view of the answers page reading this ask; withCard adds the card query so Start a meeting
// shows.
function askPage(
  head: { name: string; title: string },
  stubs: GalleryStub[],
  withCard = false,
): GalleryView {
  const url = `/asks/${ASK}${withCard ? `?card=${IDS.card}` : ""}`;
  return { ...head, pattern: ROUTE_PATTERNS.ask, url, element: <AskScreen />, stubs };
}

// The read of the ask, answering with this view.
function read(view: AskView): GalleryStub[] {
  return [{ route: routes.asks.readAsk, replies: { status: 200, body: view } }];
}

// The answers page: the persona writing, a friend's answer with its receipts, the help results,
// refused, failed, loading and error.
export const views: readonly GalleryView[] = [
  askPage(
    { name: "ask-react-writing", title: "Answers, a friend's persona writing" },
    read(reactView({ state: "asking", answers: [] })),
  ),
  askPage(
    { name: "ask-react-done", title: "Answers, how a friend would probably react" },
    read(reactView({})),
  ),
  askPage(
    { name: "ask-help-checking", title: "Answers, a help search checking the question" },
    read(askView({ state: "checking" })),
  ),
  askPage(
    { name: "ask-help-done", title: "Answers, help results with receipts" },
    read(askView({ answers: HELP_ANSWERS })),
    true,
  ),
  askPage(
    { name: "ask-help-no-card", title: "Answers, help results with no card on this phone" },
    read(askView({ answers: HELP_ANSWERS })),
  ),
  askPage(
    { name: "ask-help-none-placed", title: "Answers, no persona showed a clear sign" },
    read(askView({ answers: HELP_ANSWERS.slice(2) })),
  ),
  askPage(
    { name: "ask-help-no-match", title: "Answers, no listed persona matches" },
    read(askView({ answers: [] })),
  ),
  askPage(
    { name: "ask-refused", title: "Answers, the question was refused" },
    read(
      askView({
        state: "refused",
        refusedReason:
          "Meet First never scores people. Try: where could each of us help the other most?",
      }),
    ),
  ),
  askPage(
    { name: "ask-failed", title: "Answers, the ask could not finish" },
    read(reactView({ state: "failed", answers: [] })),
  ),
  askPage({ name: "ask-loading", title: "Answers, loading" }, [
    {
      route: routes.asks.readAsk,
      replies: { status: 200, body: askView({}), delayMs: FOREVER_MS },
    },
  ]),
  askPage({ name: "ask-error", title: "Answers, the ask failed to load" }, []),
];
