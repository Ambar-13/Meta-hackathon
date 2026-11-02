// Runs one pair through the product by HTTP, in the order of the golden path, and returns the ids the collectors need.
import { readFileSync } from "node:fs";
import type { ZodType, ZodTypeDef } from "zod";
import { CardApproveResponse, CardRequestResponse, CardView, MeetingCreateResponse, MeetingReadyResponse, MeetingView, NamesReviewResponse, PairCreateResponse, PairJoinResponse, PersonCreateResponse, PollResponse, SESSION_COOKIE, SourceCreateResponse, SourceView, routes, type MeetingEvent } from "@meet-first/contracts";
import { EvalFailure, type EvalFlags } from "./eval-flags.js";
import { buildSourceBody, extractMarkers, findInjectionPath, type PersonFixture } from "./fixture-people.js";

// One pair as the spec gives it: the two people fixtures, the question, the recall switches and the optional injection.
export type PairSpec = { a: string; b: string; questionId: number; recallA: boolean; recallB: boolean; injection?: "a" | "b" | undefined; injectionFile?: string | undefined };
// What one person's side of a driven pair came to: their id, their source, their card and their fixture name.
export type DrivenSide = { personId: string; sourceId: string; cardId: string; fixtureName: string };
// One pair after it ran: the meeting, the people, whether the brief came, and the markers planted in each side.
export type DrivenPair = {
  pairId: string;
  meetingId: string;
  persons: Record<"a" | "b", DrivenSide>;
  startedAt: string | null;
  endedAt: string | null;
  briefReady: boolean;
  markers: Record<"a" | "b", string[]>;
};

// The waits of the golden path: names 120 s, card 300 s, start 75 s, with a 3 s card poll and a 2 s event poll (R3.4, D49).
const NAMES_TIMEOUT_MS = 120_000;
const CARD_TIMEOUT_MS = 300_000;
const START_TIMEOUT_MS = 75_000;
const POLL_MS = 2_000;
const CARD_POLL_MS = 3_000;
// Names come back in pages of this size (R2.4).
const NAMES_PAGE_SIZE = 20;
// A plain call may take 30 s; an upload may take 60 s.
const CALL_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;
// The browser's fixed Origin for these calls is the base URL itself (A7).
const DISPLAY_NAMES = { a: "A", b: "B" } as const;


// Waits until read returns a value that done accepts. A timeout throws the failure given.
async function pollUntil<T>(read: () => Promise<T>, done: (value: T) => boolean, options: { timeoutMs: number; intervalMs: number; failure: EvalFailure }): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= deadline) throw options.failure;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

// Replaces the :id of a route path with the id given.
function pathFor(template: string, id: string): string {
  return template.replace(":id", id);
}

// One simulated person: a cookie jar, the Origin header on every write, and calls that check each reply against its contract.
class PersonHttp {
  private token: string | undefined;

  constructor(readonly label: "A" | "B", private readonly base: string) {}

  // Sends one JSON call, checks the status, and parses the reply with the schema.
  async call<T>(call: { method: "GET" | "POST"; path: string; expect: number; schema: ZodType<T, ZodTypeDef, unknown>; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = this.token === undefined ? {} : { cookie: `${SESSION_COOKIE}=${this.token}` };
    if (call.method !== "GET") headers.origin = this.base;
    const init: RequestInit = { method: call.method, headers, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) };
    if (call.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(call.body);
    }
    const response = await fetch(this.base + call.path, init);
    const text = await response.text();
    this.keepCookie(response.headers);
    if (response.status !== call.expect) throw new EvalFailure("eval_unexpected_status", `${this.label} got ${String(response.status)} on ${call.method} ${call.path}, expected ${String(call.expect)}.`);
    return parseReply(call.schema, text, call.path);
  }

  // Uploads one gzip NDJSON body. A refused upload (413 or 422) is recorded by its status.
  async upload(gzip: Uint8Array, fixtureName: string): Promise<SourceCreateResponse> {
    const headers: Record<string, string> = { "content-type": "application/x-ndjson", "content-encoding": "gzip", origin: this.base };
    if (this.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${this.token}`;
    const response = await fetch(`${this.base}${routes.sources.createSource.path}`, { method: "POST", headers, body: gzip, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
    const text = await response.text();
    this.keepCookie(response.headers);
    if (response.status === 413 || response.status === 422) throw new EvalFailure("eval_upload_refused", `The api refused the upload of ${fixtureName} with ${String(response.status)}.`);
    if (response.status !== 201) throw new EvalFailure("eval_unexpected_status", `${this.label} got ${String(response.status)} on POST /api/sources, expected 201.`);
    return parseReply(SourceCreateResponse, text, routes.sources.createSource.path);
  }

  // Keeps the newest session token the api sent. A cleared cookie removes it.
  private keepCookie(headers: Headers): void {
    const line = headers.getSetCookie().find((item) => item.startsWith(`${SESSION_COOKIE}=`));
    if (line === undefined) return;
    const [pair = "", ...attributes] = line.split(";");
    const value = pair.slice(SESSION_COOKIE.length + 1);
    const isCleared = value === "" || attributes.some((item) => item.trim().toLowerCase() === "max-age=0");
    this.token = isCleared ? undefined : value;
  }
}

// Parses one reply body with its schema. A body that does not match is refused with the path it came from.
function parseReply<T>(schema: ZodType<T, ZodTypeDef, unknown>, text: string, path: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new EvalFailure("eval_response_invalid", `The reply to ${path} is not JSON.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new EvalFailure("eval_response_invalid", `The reply to ${path} does not match its contract.`);
  return parsed.data;
}

// The sign-up body for one display name, with the access code when the site asks for one (ACCESS_CODE in the shell, R9.5).
function signUpBody(displayName: string): { displayName: string; accessCode?: string } {
  const accessCode = (process.env.ACCESS_CODE ?? "").trim();
  return accessCode === "" ? { displayName } : { displayName, accessCode };
}

// Makes one person, uploads their source, freezes the names, builds and approves their card. Returns the ids.
async function prepareSide(client: PersonHttp, fixture: PersonFixture, options: { displayName: string; recallAllowed: boolean }) {
  const created = await client.call({ method: "POST", path: routes.people.createPerson.path, expect: 201, schema: PersonCreateResponse, body: signUpBody(options.displayName) });
  const body = await buildSourceBody(fixture);
  const upload = await client.upload(body.gzip, fixture.name);
  const sourceId = upload.sourceId;
  const sourcePath = pathFor(routes.sources.readSource.path, sourceId);
  const view = await pollUntil(() => client.call({ method: "GET", path: `${sourcePath}?page=1`, expect: 200, schema: SourceView }), (value) => value.namesPassDone, { timeoutMs: NAMES_TIMEOUT_MS, intervalMs: POLL_MS, failure: new EvalFailure("eval_names_pass_timeout", `The names check did not finish for ${fixture.name} within 120 s.`) });
  await reviewNames(client, sourceId, view);
  const cardId = await buildCard(client, sourceId);
  await approveCard(client, cardId, options.recallAllowed);
  return { personId: created.personId, sourceId, cardId };
}

// Reads every page of names and sends the review that replaces each one (R2.4, every name replaced by default).
async function reviewNames(client: PersonHttp, sourceId: string, first: SourceView): Promise<void> {
  const pages = Math.max(1, Math.ceil(first.names.total / NAMES_PAGE_SIZE));
  const rows = [...first.names.rows];
  for (let page = 2; page <= pages; page += 1) {
    const view = await client.call({ method: "GET", path: `${pathFor(routes.sources.readSource.path, sourceId)}?page=${String(page)}`, expect: 200, schema: SourceView });
    rows.push(...view.names.rows);
  }
  await client.call({
    method: "POST",
    path: pathFor(routes.sources.namesReview.path, sourceId),
    expect: 200,
    schema: NamesReviewResponse,
    body: { decisions: rows.map((row) => ({ text: row.text, keep: false })), sensitiveOptIn: [] },
  });
}

// Asks for the card on a source and waits until it is no longer building. A failed card stops this pair.
async function buildCard(client: PersonHttp, sourceId: string): Promise<string> {
  const requested = await client.call({ method: "POST", path: pathFor(routes.sources.requestCard.path, sourceId), expect: 202, schema: CardRequestResponse });
  const cardPath = pathFor(routes.cards.readCard.path, requested.cardId);
  const card = await pollUntil(() => client.call({ method: "GET", path: cardPath, expect: 200, schema: CardView }), (value) => value.state !== "building", { timeoutMs: CARD_TIMEOUT_MS, intervalMs: CARD_POLL_MS, failure: new EvalFailure("eval_card_failed", "The card did not finish building within 300 s.") });
  if (card.state === "failed") throw new EvalFailure("eval_card_failed", "The card build failed. Read the worker log for the card id.");
  return requested.cardId;
}

// Approves the verified items of a card with the recall switch the pair sets for this side (R7.1).
async function approveCard(client: PersonHttp, cardId: string, recallAllowed: boolean): Promise<void> {
  const card = await client.call({ method: "GET", path: pathFor(routes.cards.readCard.path, cardId), expect: 200, schema: CardView });
  const itemIds = card.items.filter((item) => item.verified).map((item) => item.id);
  await client.call({ method: "POST", path: pathFor(routes.cards.approveCard.path, cardId), expect: 200, schema: CardApproveResponse, body: { itemIds, recallAllowed } });
}

// Reads the invite token from the link. The token sits after "#", so it never reaches a server log (D32).
function tokenOf(inviteUrl: string): string {
  return new URL(inviteUrl).hash.slice(1);
}

// Follows the meeting by its poll route for both sides until brief.ready, a deleted end, or the timeout. Returns what the run needs.
async function followMeeting(sides: { a: PersonHttp; b: PersonHttp }, meetingId: string, timeoutMs: number) {
  const seen = new Map<number, MeetingEvent>();
  const cursor = { a: 0, b: 0 };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !isFinished(seen)) {
    for (const side of ["a", "b"] as const) {
      const person = side === "a" ? sides.a : sides.b;
      const reply = await person.call({ method: "GET", path: `${pathFor(routes.meetings.events.path, meetingId)}?after=${String(cursor[side])}`, expect: 200, schema: PollResponse });
      for (const event of reply.events) {
        seen.set(event.seq, event);
        cursor[side] = Math.max(cursor[side], event.seq);
      }
    }
    if (!isFinished(seen)) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return summarize(seen);
}

// Whether the stream has its brief or a deleted end, so the follow can stop.
function isFinished(seen: Map<number, MeetingEvent>): boolean {
  return [...seen.values()].some((event) => event.type === "brief.ready" || (event.type === "meeting.ended" && event.reason === "deleted"));
}

// Reads the start time, the end time and whether the brief came from the events seen.
function summarize(seen: Map<number, MeetingEvent>): { briefReady: boolean; startedAt: string | null; endedAt: string | null } {
  const events = [...seen.values()];
  const started = events.find((event) => event.type === "meeting.started");
  const ended = events.find((event) => event.type === "meeting.ended");
  return {
    briefReady: events.some((event) => event.type === "brief.ready"),
    startedAt: started?.type === "meeting.started" ? started.startedAt : null,
    endedAt: ended?.type === "meeting.ended" ? ended.endedAt : null,
  };
}

// Looks up the fixture for one side; a missing file is refused with eval_fixture_missing, and the run goes on.
function fixtureFor(fixtures: Map<string, PersonFixture>, name: string): PersonFixture {
  const fixture = fixtures.get(name);
  if (fixture === undefined) throw new EvalFailure("eval_fixture_missing", `The people file ${name} is missing from fixtures/people. Add it, or leave this pair out.`);
  return fixture;
}

// The fixture for one side, with its injection file when the pair plants one there, and the markers that file plants.
// Only a paste source can carry an injection, because a card is built from one source.
function sideFixture(fixture: PersonFixture, spec: PairSpec, side: "a" | "b"): { fixture: PersonFixture; markers: string[] } {
  if (spec.injection !== side || spec.injectionFile === undefined) return { fixture, markers: [] };
  if (fixture.kind !== "paste") throw new EvalFailure("eval_injection_unsupported", `The injected side ${fixture.name} must be a paste file; a card is built from one source.`);
  const injectionPath = findInjectionPath(spec.injectionFile);
  if (injectionPath === undefined) throw new EvalFailure("eval_fixture_missing", `The injection file ${spec.injectionFile} is missing from fixtures/injection.`);
  return { fixture: { ...fixture, injectionPath }, markers: extractMarkers(readFileSync(injectionPath, "utf8")) };
}

// Runs one pair end to end: two people, their sources and cards, the pair, the meeting, and the follow to the brief.
export async function drivePair(spec: PairSpec, flags: EvalFlags, fixtures: Map<string, PersonFixture>): Promise<DrivenPair> {
  const sideA = sideFixture(fixtureFor(fixtures, spec.a), spec, "a");
  const sideB = sideFixture(fixtureFor(fixtures, spec.b), spec, "b");
  const a = new PersonHttp("A", flags.baseUrl);
  const b = new PersonHttp("B", flags.baseUrl);
  const playerA = await prepareSide(a, sideA.fixture, { displayName: DISPLAY_NAMES.a, recallAllowed: spec.recallA });
  const playerB = await prepareSide(b, sideB.fixture, { displayName: DISPLAY_NAMES.b, recallAllowed: spec.recallB });
  const pair = await a.call({ method: "POST", path: routes.meetings.createPair.path, expect: 201, schema: PairCreateResponse });
  await b.call({ method: "POST", path: routes.meetings.joinPair.path, expect: 200, schema: PairJoinResponse, body: { token: tokenOf(pair.inviteUrl) } });
  const meeting = await a.call({ method: "POST", path: pathFor(routes.meetings.createMeeting.path, pair.pairId), expect: 201, schema: MeetingCreateResponse, body: { questionId: spec.questionId, cardId: playerA.cardId } });
  await a.call({ method: "POST", path: pathFor(routes.meetings.ready.path, meeting.meetingId), expect: 200, schema: MeetingReadyResponse });
  await b.call({ method: "POST", path: pathFor(routes.meetings.ready.path, meeting.meetingId), expect: 200, schema: MeetingReadyResponse });
  await pollUntil(() => a.call({ method: "GET", path: pathFor(routes.meetings.readMeeting.path, meeting.meetingId), expect: 200, schema: MeetingView }), (view) => view.state !== "ready", { timeoutMs: START_TIMEOUT_MS, intervalMs: POLL_MS, failure: new EvalFailure("eval_start_timeout", "The meeting did not leave ready within 75 s of both go-aheads. Check that the worker is running.") });
  const followed = await followMeeting({ a, b }, meeting.meetingId, flags.timeoutMs);
  return {
    pairId: pair.pairId,
    meetingId: meeting.meetingId,
    persons: { a: { ...playerA, fixtureName: spec.a }, b: { ...playerB, fixtureName: spec.b } },
    startedAt: followed.startedAt,
    endedAt: followed.endedAt,
    briefReady: followed.briefReady,
    markers: { a: sideA.markers, b: sideB.markers },
  };
}
