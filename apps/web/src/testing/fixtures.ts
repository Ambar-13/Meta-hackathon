import {
  CardView,
  CommittedEvent,
  CURATED_QUESTIONS,
  NAMES_PAGE_SIZE,
  PairView,
  PersonCreateResponse,
  QUIZ_BANK,
  QUIZ_ITEMS,
  quizCopy,
  QuizView,
  ReplayExport,
  SourceView,
  TurnDelta,
  MeetingView,
  type Claim,
  type CardItem,
  type PairMeetingRow,
  type Phase,
  type QuizItemView,
  type CardState,
} from "@meet-first/contracts";

// The shared prefix of every fixed uuid in the web tests.
const UUID_PREFIX = "00000000-0000-4000-8000-";
// Fixed row ids that every test uses.
export const IDS = {
  personA: `${UUID_PREFIX}000000000101`,
  personB: `${UUID_PREFIX}000000000102`,
  source: `${UUID_PREFIX}000000000121`,
  card: `${UUID_PREFIX}000000000111`,
  quiz: `${UUID_PREFIX}000000000131`,
  pair: `${UUID_PREFIX}000000000141`,
  meeting: `${UUID_PREFIX}000000000201`,
  comic: `${UUID_PREFIX}000000000221`,
  turnA: `${UUID_PREFIX}000000000301`,
  claimA: `${UUID_PREFIX}000000000311`,
} as const;
// The id of the nth card item, 1 based.
export function itemId(n: number): string {
  return `${UUID_PREFIX}${String(400 + n).padStart(12, "0")}`;
}
// The fixed server time every fixture uses.
export const SERVER_NOW = "2026-10-27T10:00:00.000Z";
// A recovery code in the contracts alphabet, 32 characters.
export const RECOVERY_CODE = "abcdefghjkmnpqrstuvwxyz234567892";
// A 32 hex character invite token.
export const INVITE_TOKEN = "0123456789abcdef0123456789abcdef";
// A 32 hex character transfer token.
export const TRANSFER_TOKEN = "fedcba9876543210fedcba9876543210";

// The quiz question text for position n, read from the quiz bank; throws when the bank has no such entry.
function bankText(n: number): string {
  const entry = QUIZ_BANK[n - 1];
  if (entry === undefined) throw new Error(`the quiz bank has no question ${String(n)}`);
  return entry.text;
}

// The curated question at index 2, the one the fixtures use.
function curatedText(): string {
  const entry = CURATED_QUESTIONS[2];
  if (entry === undefined) throw new Error("the curated questions have no third entry");
  return entry.text;
}

// A POST /api/people reply (PersonCreateResponse).
export function personCreated(): PersonCreateResponse {
  return PersonCreateResponse.parse({ personId: IDS.personA, recoveryCode: RECOVERY_CODE });
}

// One page of a SourceView with `total` names, 20 per page (R2.4). The names check has finished.
export function sourceView(page: number, total: number): SourceView {
  const first = (page - 1) * NAMES_PAGE_SIZE;
  const last = Math.min(total, page * NAMES_PAGE_SIZE);
  const rows = [];
  for (let index = first; index < last; index += 1) {
    const roleToken = index % 2 === 0 ? "[person:friend]" : "[person:manager]";
    rows.push({ text: `Name ${String(index + 1)}`, roleToken, context: `lunch with ${roleToken} today`, keep: false });
  }
  return SourceView.parse({
    id: IDS.source,
    kind: "paste",
    turnCount: 8,
    redactionCount: 1,
    personaSignal: 0.6,
    namesPassDone: true,
    namesReviewedAt: null,
    frozenAt: null,
    names: { page, pageSize: NAMES_PAGE_SIZE, total, rows },
    serverNow: SERVER_NOW,
  });
}

// One card item n, 1 based, with the claim, quote and flags the screens show.
function cardItem(n: number, state: CardState): CardItem {
  const kinds = ["value", "preference", "habit", "boundary", "goal"] as const;
  const kind = kinds[(n - 1) % kinds.length] ?? "value";
  return {
    id: itemId(n),
    position: n,
    kind,
    claim: `Claim number ${String(n)}`,
    lang: "en",
    gloss: `Claim number ${String(n)}`,
    turnId: IDS.turnA,
    quote: `I said this in my own words, number ${String(n)}`,
    verified: true,
    flagged: false,
    approved: state === "approved",
    sensitive: false,
  };
}

// How many items a card in each state holds.
const ITEM_COUNT_BY_STATE: Partial<Record<CardState, number>> = { ready: 6, approved: 6, thin: 3 };
// A CardView in one state; ready and approved have 6 items, thin has 3, building and failed none.
export function cardView(state: CardState, serverNow: string = SERVER_NOW): CardView {
  const count = ITEM_COUNT_BY_STATE[state] ?? 0;
  const items = Array.from({ length: count }, (unused, index) => cardItem(index + 1, state));
  const hasItems = state !== "building" && state !== "failed";
  return CardView.parse({
    id: IDS.card,
    sourceId: IDS.source,
    state,
    thin: state === "thin",
    recallAllowed: false,
    itemsTotal: hasItems ? items.length : null,
    itemsVerified: hasItems ? items.length : null,
    items,
    builtAt: hasItems ? SERVER_NOW : null,
    serverNow,
  });
}

// A QuizView in one state; judged carries both answers and matched 7.
export function quizView(state: QuizView["state"]): QuizView {
  const items = Array.from({ length: QUIZ_ITEMS }, (unused, index): QuizItemView => {
    const n = index + 1;
    const base = { position: n, questionId: n, questionText: bankText(n) };
    if (state !== "judged") return base;
    return { ...base, personaAnswer: `Persona answer ${String(n)}`, humanAnswer: `My answer ${String(n)}`, agree: n <= 7 };
  });
  const isJudged = state === "judged";
  return QuizView.parse({
    id: IDS.quiz,
    state,
    items,
    ...(isJudged ? { matched: 7, reliable: true } : {}),
    copy: isJudged ? quizCopy(7, true) : "",
  });
}

// A PairView with or without the joiner, holding the given meeting rows.
export function pairView(options: { hasJoiner: boolean; meetings: PairMeetingRow[] }): PairView {
  return PairView.parse({
    id: IDS.pair,
    creator: { displayName: "A" },
    ...(options.hasJoiner ? { joiner: { displayName: "B" } } : {}),
    meetings: options.meetings,
    expiresAt: "2026-10-28T10:00:00.000Z",
    serverNow: SERVER_NOW,
  });
}

// A MeetingView for IDS.meeting with the given fields replaced; the viewer is side a unless told otherwise.
export function meetingView(overrides: Partial<MeetingView>): MeetingView {
  return MeetingView.parse({
    id: IDS.meeting,
    state: "ready",
    questionText: curatedText(),
    questionChecked: true,
    members: [
      { side: "a", displayName: "A", ready: false, connected: false },
      { side: "b", displayName: "B", ready: false, connected: false },
    ],
    viewerSide: "a",
    serverNow: SERVER_NOW,
    ...overrides,
  });
}

// A claim of side a; a false argument makes it flagged and unverified (R6.5).
export function claimFixture(isVerified: boolean): Claim {
  return {
    id: IDS.claimA,
    side: "a",
    position: 1,
    text: "A prefers mornings",
    quote: "I work best before nine in the morning",
    lang: "en",
    turnId: IDS.turnA,
    verified: isVerified,
    flagged: !isVerified,
    evidenceValid: isVerified,
  };
}

// The fields every committed event carries.
function committedBase(seq: number): { v: 1; meetingId: string; at: string; seq: number } {
  return { v: 1, meetingId: IDS.meeting, at: SERVER_NOW, seq };
}

// The meeting.started event of IDS.meeting, with A on side a and B on side b.
export function meetingStarted(seq: number): CommittedEvent {
  return CommittedEvent.parse({
    ...committedBase(seq),
    type: "meeting.started",
    startedAt: SERVER_NOW,
    endsAt: "2026-10-27T10:10:00.000Z",
    question: curatedText(),
    members: [
      { side: "a", displayName: "A" },
      { side: "b", displayName: "B" },
    ],
  });
}

// The phase.changed event that moves the meeting to a phase.
export function phaseChanged(seq: number, phase: Phase, stepSeq: number): CommittedEvent {
  return CommittedEvent.parse({ ...committedBase(seq), type: "phase.changed", phase, stepSeq });
}

// The turn.delta frame for a slice of a turn that is still being written. Takes one object so the call stays within three parameters.
export function turnDelta(slot: { stepSeq: number; attempt: number; side: "a" | "b"; offset: number; text: string }): TurnDelta {
  return TurnDelta.parse({ v: 1, meetingId: IDS.meeting, at: SERVER_NOW, type: "turn.delta", ...slot });
}

// The turn.committed event with its claims, in the open phase. Takes one object so the call stays within three parameters.
export function turnCommitted(slot: { seq: number; stepSeq: number; side: "a" | "b"; text: string; claims?: Claim[] }): CommittedEvent {
  return CommittedEvent.parse({ ...committedBase(slot.seq), type: "turn.committed", stepSeq: slot.stepSeq, side: slot.side, phase: "open", text: slot.text, claims: slot.claims ?? [] });
}

// The tool.called event for a recall lookup by one side.
export function recallCalled(seq: number, side: "a" | "b", query: string): CommittedEvent {
  return CommittedEvent.parse({ ...committedBase(seq), type: "tool.called", stepSeq: 1, side, tool: "recall", args: { query } });
}

// The meeting.ended event for a decided meeting.
export function meetingEnded(seq: number): CommittedEvent {
  return CommittedEvent.parse({ ...committedBase(seq), type: "meeting.ended", reason: "decided", endedAt: "2026-10-27T10:09:00.000Z" });
}

// The brief.ready event with the two support rates.
export function briefReady(seq: number): CommittedEvent {
  return CommittedEvent.parse({ ...committedBase(seq), type: "brief.ready", supportRate: { a: 0.889, b: 1 } });
}

// A ReplayExport of IDS.meeting holding the given events.
export function replayExport(events: CommittedEvent[]): ReplayExport {
  return ReplayExport.parse({ meetingId: IDS.meeting, exportedAt: SERVER_NOW, events });
}
