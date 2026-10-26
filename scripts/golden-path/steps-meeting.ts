// Steps 8 to 12: the streamed meeting, the background return, the removed ask steps, and the decision.
import { MeetingEnded, MeetingStarted, routes, type MeetingEvent, type ToolResult, type TurnCommitted, type TurnDelta } from "@meet-first/contracts";
import { countEvents, countEventsByType, readMeeting } from "./database-reads.js";
import type { EventStreamReader } from "./event-stream-reader.js";
import { PLANNED_DISCONNECT_SEQ } from "./fixtures.js";
import { check, finishStep, need, pollUntil, readers, routePath, sleep, type Assertion, type RunState, type StepResult } from "./report.js";

// The first and second turns may take 120 s each (first token 20 s plus the 90 s speech cap, D39).
const TURN_TIMEOUT_MS = 120_000;
// The meeting may run for 14 minutes from its start: the 13-minute worst case plus a minute (design step 12).
const MEETING_WAIT_MS = 840_000;
// The longest a meeting may last before it must have ended, in seconds (design step 12).
const DECIDE_LIMIT_SECONDS = 780;
// The background return: reader A closes for this long while B is writing (design step 11).
const BACKGROUND_MS = 20_000;
// The mid-turn wait: B must write a delta within this long (design step 11).
const MID_TURN_TIMEOUT_MS = 180_000;
// After the background return, the replay arrives within this long (R8.1).
const REPLAY_TIMEOUT_MS = 5_000;
// The poll interval for arrivals that a helper is waiting on.
const ARRIVAL_POLL_MS = 100;
// The wait that lets the second reader catch up before counts are compared.
const STRAGGLER_MS = 5_000;
// The seq the stream reaches once the first reader has resumed after the planned cut (step 8).
const RESUMED_SEQ = PLANNED_DISCONNECT_SEQ + 1;
// The number of turns one recall lookup may return for A's persona (D38).
const RECALL_MAX_TURNS = 5;

// The turns a reader has committed, in order.
function turnsOf(reader: EventStreamReader): TurnCommitted[] {
  return reader.committed.filter((event): event is TurnCommitted => event.type === "turn.committed");
}

// Whether the turns both readers hold read the same text and claims, comparing every step both have seen.
function sameTurnsOnBothScreens(a: EventStreamReader, b: EventStreamReader): { isSame: boolean; shared: number } {
  const turnsB = turnsOf(b);
  const shared = turnsOf(a).flatMap((turn) => {
    const other = turnsB.find((item) => item.stepSeq === turn.stepSeq);
    return other === undefined ? [] : [{ turn, other }];
  });
  const isSame = shared.every(({ turn, other }) => other.text === turn.text && JSON.stringify(other.claims) === JSON.stringify(turn.claims));
  return { isSame, shared: shared.length };
}

// The number of turns a recall result returned, or -1 when the result has no turns list.
function turnsIn(result: Record<string, unknown>): number {
  const turns = result.turns;
  return Array.isArray(turns) ? turns.length : -1;
}

// Whether the offsets of each turn attempt rise and never fall (D47).
function offsetsRise(deltas: readonly TurnDelta[]): boolean {
  const last = new Map<string, number>();
  return deltas.every((delta) => {
    const key = `${String(delta.stepSeq)}:${String(delta.attempt)}`;
    const previous = last.get(key) ?? -1;
    last.set(key, delta.offset);
    return delta.offset >= previous;
  });
}

// Waits until a reader has an arrival after the mark that matches, or until the time runs out.
async function arrivalAfter(reader: EventStreamReader, search: { mark: number; predicate: (event: MeetingEvent) => boolean; timeoutMs: number }): Promise<MeetingEvent | undefined> {
  const deadline = Date.now() + search.timeoutMs;
  for (;;) {
    const found = reader.arrivals.slice(search.mark).find(search.predicate);
    if (found !== undefined || Date.now() >= deadline) return found;
    await sleep(ARRIVAL_POLL_MS);
  }
}

// The checks on the recall switch: A's persona calls recall (when the run is mock or it did), and B's lookups return nothing.
function recallChecks(a: EventStreamReader, isMock: boolean, notes: string[]): Assertion[] {
  const isRecallCalled = a.committed.some((event) => event.type === "tool.called" && event.tool === "recall" && event.side === "a");
  const results = a.committed.filter((event): event is ToolResult => event.type === "tool.result" && event.tool === "recall");
  const toB = results.filter((event) => event.side === "b");
  const toA = results.filter((event) => event.side === "a");
  const checks: Assertion[] = [check("B's recall results hold no turns", true, toB.every((event) => turnsIn(event.result) === 0))];
  if (isMock || isRecallCalled) checks.push(check("A's persona calls recall", true, isRecallCalled));
  else notes.push("A's persona did not call recall (not exercised: model choice)");
  if (isMock) checks.push(check("A's recall results hold one to five turns", true, toA.every((event) => turnsIn(event.result) >= 1 && turnsIn(event.result) <= RECALL_MAX_TURNS)));
  return checks;
}

// The checks on the deltas: a delta comes before its commit, and the offsets of each attempt rise. A live run without deltas is a warning.
function deltaChecks(a: EventStreamReader, isMock: boolean, notes: string[]): Assertion[] {
  const firstTurn = turnsOf(a)[0];
  const deltaFirst = firstTurn === undefined ? -1 : a.arrivals.findIndex((event) => event.type === "turn.delta" && event.stepSeq === firstTurn.stepSeq);
  const commitFirst = firstTurn === undefined ? -1 : a.arrivals.findIndex((event) => event.type === "turn.committed" && event.stepSeq === firstTurn.stepSeq);
  const checks: Assertion[] = [check("the offsets of each attempt never fall", true, offsetsRise(a.deltas))];
  if (deltaFirst >= 0 && deltaFirst < commitFirst) notes.push("a delta arrived before the first commit");
  else if (isMock) checks.push(check("a delta arrives before the first matching commit", true, false));
  else notes.push("warning: no deltas before first commit; proxy buffering likely (R8.2)");
  return checks;
}

// The cut at seq 20: under mock the stream must reach it, and the first event after it must be seq 21.
function cutChecks(a: EventStreamReader, isMock: boolean, notes: string[]): Assertion[] {
  const hasCut = a.committed.some((event) => event.seq === PLANNED_DISCONNECT_SEQ);
  if (!hasCut) {
    notes.push("seq 20 not reached before the meeting ended (not exercised)");
    return isMock ? [check("A's stream reaches seq 20 before the meeting ends", true, false)] : [];
  }
  const index = a.committed.findIndex((event) => event.seq === PLANNED_DISCONNECT_SEQ);
  return [check("seq-20 reconnect", RESUMED_SEQ, a.committed[index + 1]?.seq)];
}

// Step 8: both screens show the same turns, the recall switch works on A's side only, deltas arrive before the commit, and the cut at seq 20 resumes with 21.
// Under a live run a missing recall call, missing deltas or a meeting that ends before seq 20 are noted, not failed (R8.2, model choice).
export async function step08Stream(run: RunState): Promise<StepResult> {
  const { a, b } = readers(run);
  const isMock = run.options.mode === "mock";
  const notes: string[] = [];
  await a.waitFor((event) => event.type === "turn.committed", TURN_TIMEOUT_MS);
  await a.waitFor((event) => event.type === "turn.committed" && event.side === "b", TURN_TIMEOUT_MS);
  await pollUntil(() => Promise.resolve(turnsOf(b).length), (count) => count >= turnsOf(a).length, { timeoutMs: 10_000, intervalMs: ARRIVAL_POLL_MS });
  const screens = sameTurnsOnBothScreens(a, b);
  const assertions: Assertion[] = [check("both screens show the same turn text and claims", true, screens.isSame && screens.shared >= 1)];
  assertions.push(...recallChecks(a, isMock, notes), ...deltaChecks(a, isMock, notes));
  await a.waitFor((event) => event.type === "meeting.ended" || ("seq" in event && event.seq === RESUMED_SEQ), MEETING_WAIT_MS);
  assertions.push(...cutChecks(a, isMock, notes));
  a.assertGapless();
  return finishStep(8, "stream", {
    rows: ["R5.7", "R7.1", "D47", "R8.1"],
    detail: [`commits=${String(turnsOf(a).length)}`, `cut at seq 20 ${a.hasPlannedDisconnect ? "made" : "not made"}`, ...notes].join("; "),
    assertions,
  });
}

// The removed ask step: it keeps its number and never fails (as-built item 28).
export function removedStep(number: number, name: string): StepResult {
  return { number, name, result: "removed", durationMs: 0, detail: "ask my human was dropped (as-built item 28)", rows: [], assertions: [] };
}

// Step 11: A backgrounds the page during B's turn. The replay after the return has no gap and no duplicate, and the mid-turn text comes back.
export async function step11Background(run: RunState): Promise<StepResult> {
  const { a } = readers(run);
  const meetingId = need(run.ids.meetingId, "meetingId");
  const assertions: Assertion[] = [];
  const isMidTurn = await a.waitFor((event) => event.type === "turn.delta" && event.side === "b", MID_TURN_TIMEOUT_MS).then(
    () => true,
    () => false,
  );
  if (run.options.mode === "mock") assertions.push(check("B writes a delta during the window", true, isMidTurn));
  const lastSeq = a.lastSeq;
  const mark = a.arrivals.length;
  a.close();
  await sleep(BACKGROUND_MS);
  await a.open();
  const replayed = await arrivalAfter(a, {
    mark,
    predicate: (event) => ("seq" in event && event.seq > lastSeq) || (event.type === "turn.delta" && event.offset === 0 && event.text.length >= 1),
    timeoutMs: REPLAY_TIMEOUT_MS,
  });
  const committedAfter = a.committed.filter((event) => event.seq > lastSeq);
  assertions.push(
    check("a replay or the mid-turn text arrives within 5 s of reopening", true, replayed !== undefined),
    check("the first committed event after reopening follows on with no gap", true, committedAfter.length === 0 || committedAfter[0]?.seq === lastSeq + 1),
  );
  const pollPath = `${routePath(routes.meetings.events.path, { id: meetingId })}?after=${String(lastSeq - 1)}`;
  const poll = await run.a.json({ method: "GET", path: pollPath, expect: 200, schema: routes.meetings.events.response });
  assertions.push(check("the poll route starts at the last seq", lastSeq, poll.body.events[0]?.seq), check("the poll route speaks version 1", 1, poll.body.v));
  a.assertGapless();
  run.manual.push("A backgrounds Safari for 20 s during B's turn and returns; nothing is missing; the mid-turn text is present (R8.3)");
  const detail = isMidTurn ? `reopened after seq ${String(lastSeq)}; replay or mid-turn text seen: ${String(replayed !== undefined)}` : "not exercised: no mid-turn delta in the window (live run)";
  return finishStep(11, "background", { rows: ["R8.3", "R8.1", "D49"], detail, assertions });
}

// The concede and hold checks of the decision: each side concedes or holds, and under mock there is exactly one scripted concede.
function decisionChecks(a: EventStreamReader, isMock: boolean): Assertion[] {
  const concedes = a.committed.filter((event) => event.type === "concede").length;
  const isEachSide = (["a", "b"] as const).every((side) => a.committed.some((event) => (event.type === "concede" || event.type === "hold") && event.side === side));
  const checks: Assertion[] = [
    check("a decide phase was reached", true, a.committed.some((event) => event.type === "phase.changed" && event.phase === "decide")),
    check("each side concedes or holds", true, isEachSide),
  ];
  if (isMock) checks.push(check("exactly one scripted concede", 1, concedes));
  return checks;
}

// Step 12: the meeting decides within 13 minutes. Both readers agree on the turns, and the database has one meeting.ended.
export async function step12Decide(run: RunState): Promise<StepResult> {
  const { a, b } = readers(run);
  const meetingId = need(run.ids.meetingId, "meetingId");
  const started = a.committed.find((event): event is MeetingStarted => event.type === "meeting.started");
  const startedMs = started === undefined ? Date.now() : Date.parse(started.startedAt);
  await a.waitFor((event) => event.type === "meeting.ended", Math.max(0, startedMs + MEETING_WAIT_MS - Date.now()));
  const ended = need(a.committed.find((event): event is MeetingEnded => event.type === "meeting.ended"), "meeting.ended");
  const endedSeconds = (Date.parse(ended.endedAt) - startedMs) / 1000;
  const assertions: Assertion[] = [
    check("the meeting ended because it decided", "decided", ended.reason),
    check("the meeting ended within 13 minutes", true, endedSeconds <= DECIDE_LIMIT_SECONDS),
    ...decisionChecks(a, run.options.mode === "mock"),
  ];
  await sleep(STRAGGLER_MS);
  a.assertGapless();
  b.assertGapless();
  const counted = await countEvents(run.db, meetingId);
  const screens = sameTurnsOnBothScreens(a, b);
  const row = await readMeeting(run.db, meetingId);
  assertions.push(
    check("both readers hold the same last seq", a.lastSeq, b.lastSeq),
    check("the database holds the same last seq", a.lastSeq, counted.max),
    check("both screens show the same turn text across the meeting", true, screens.isSame),
    check("the database says ended", "ended", row.state),
    check("the database says decided", "decided", row.end_reason),
    check("ended_at is set", true, row.ended_at !== null),
    check("one meeting.ended is stored", 1, await countEventsByType(run.db, meetingId, "meeting.ended")),
  );
  const concedes = a.committed.filter((event) => event.type === "concede").length;
  const holds = a.committed.filter((event) => event.type === "hold").length;
  const detail = `reason=${ended.reason} endedAfter=${String(Math.round(endedSeconds))}s concede=${String(concedes)} hold=${String(holds)} events=${String(counted.count)}`;
  return finishStep(12, "decide", { rows: ["R5.8", "D42", "D34"], detail, assertions });
}
