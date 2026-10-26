# Contracts: where names live and what crosses each boundary

Read this page after the spec. Every name below is the name in code. It was frozen at the Wave 0 review; after the freeze, change it only through `requests/` (D75).

## 1. Where names live

| Folder and file | zod schemas and their fields |
|---|---|
| `people/person-create.ts` | `PersonCreate {displayName (non-empty), affiliations?: string[]}`; `PersonCreateResponse {personId, recoveryCode: 32 chars}` |
| `people/sessions.ts` | `Recover {code}`; `TransferResponse {url, expiresAt}`; `TransferClaim {token}`; the cookie name constant `SESSION_COOKIE = '__Host-session'` |
| `sources/turn.ts` | `Turn {turnIndex: int, role: 'user', text: string (max 20000), lang?: string, sensitiveCategories: Category[]}`; `SourceHeader {kind: 'chatgpt'|'claude'|'notes'|'paste', parserVersion, scrubVersion, personaSignal: number, attested: true, turnCount: int (1..10000)}`; the NDJSON body is one `SourceHeader` line then `Turn` lines |
| `sources/scrub-categories.ts` | `Category` enum (the 17 values in ARCHITECTURE.md 3.6); `Redaction {category, placeholderId: 8 hex}`; `ScrubResult {text, redactions: Redaction[]}` |
| `sources/source-view.ts` | `SourceView {id, kind, turnCount, redactionCount, personaSignal, namesPassDone: boolean, namesReviewedAt, frozenAt, names: {page, pageSize: 20, total, rows: [{text, roleToken, context, keep}]}, serverNow}`; `NamesReview {decisions: [{text, keep: boolean}], sensitiveOptIn: Category[]}` |
| `cards/card.ts` | `CardItem {id, position, kind: 'value'|'preference'|'habit'|'boundary'|'goal', claim, lang, gloss, turnId, quote, verified, flagged, approved, sensitive}`; `CardView {id, sourceId, state, thin, recallAllowed, itemsTotal, itemsVerified, items: CardItem[], builtAt, serverNow}`; `CardApprove {itemIds: uuid[], recallAllowed: boolean}`; `CardItemSource {turnIndex, text, highlight: {start, end} | null}` |
| `cards/quiz.ts` | `QuizItemView {position, questionId, questionText, personaAnswer?: string (omitted until humanAnswer set), humanAnswer?, agree?}`; `QuizView {id, state, items, matched?, reliable?, copy: string}`; `QuizAnswers {answers: [{position, text: string (max 200)}] length 10}` |
| `cards/quiz.ts` (judge records) | `QuizJudgeRaw {run: 1|2, isHumanFirst, output: QuizJudgeOutput, ledgerId}` for `quiz_items.judge_raw`; `QuizCalibrationRun {run, entryIndex: 0..7, isPassed, pairs: [{pair: 'identical'|'contradicting', shouldAgree, output|null, isPassed, ledgerId}] length 2}`; `QuizCalibrationRaw` = 1 or 2 runs, for `quizzes.calibration_raw` |
| `cards/quiz-bank.ts`, `cards/seeded-sample.ts` | `QUIZ_BANK_VERSION = 1`; `QUIZ_BANK: {id: 1..30, text}[]`; `QUIZ_SAMPLE_SIZE = 10`; `sampleQuiz(cardId): number[10]` ascending, seeded by the lower-case card id: the first 8 bytes of its sha256, SplitMix64, Fisher-Yates from the last place down (D28). The same in Node and the browser |
| `meetings/pair.ts` | `PairCreateResponse {pairId, inviteUrl, expiresAt}`; `PairJoin {token}`; `PairView {id, creator: {displayName}, joiner?: {displayName}, meetings: [{id, state, questionText, queuePosition?, createdAt}] newest first, expiresAt, serverNow}` |
| `meetings/meeting.ts` | `MeetingCreate ({questionId: 1..12} | {freeText: string}) & {cardId}`; `MeetingView {id, state, phase?, questionText, questionChecked: boolean, members: [{side, displayName, ready, connected}], viewerSide, startedAt?, endsAt?, queuePosition?, serverNow}`; `CURATED_QUESTIONS: {id: 1..12, text}[]` (R10.5) |
| `meetings/events.ts` | `EVENT_VERSION = 1`; the 15 event schemas in 2.4; `MeetingEvent` union on `type`; committed events carry `seq`; `MeetingEventRow`, `rowToEvent(row)` (throws `event_row_invalid`, 500) and `eventToPayload(event)` |
| `meetings/tools.ts` | `recallArgs {query}`, `recallResult {turns: [{turnId, text}] max 5}`; `askArgs {question}`, `askResult {answer} | {expired: true, text}`; `concedeArgs {claimId, reason}`; `holdArgs {reason}`; `toolsForPhase(phase, askBudgetLeft, round)` returns the `tools` array or undefined (D35, D37, D42) |
| `meetings/claims.ts` | `Claim {id, side, position, text, quote, gloss?, lang, turnId, verified, flagged, evidenceValid}`; `ReceiptsOutput {claims: [{text, quote, turn_id, lang, gloss}]}` |
| `briefs/brief.ts` | `Quote {text, side, turnId, verified}`; `BriefPoint {text, quotes: Quote[], supported: boolean | null, supportReason?}`; `Brief {agree: BriefPoint[3], clash: BriefPoint[3], decideFirst: BriefPoint[3], supportRate: number | null, supportReliable: boolean | null}` |
| `briefs/comic.ts` | `AVATARS: 6 fixed descriptors` (one is "fox in a hoodie"; the other five are written in Wave 0); `ComicRequest {avatar: Avatar}`; `ComicView {state, panels: [{position, caption, imageUrl}]}` |
| `briefs/share.ts` | `ShareSnapshot {question, people: [{side, displayName}], items: [{side, kind, claim, quote}], turns: [{side, text, claims: [{text, quote}]}], brief: {agree, clash, decideFirst} of `{text, quotes: [{text, side}]}` (supported lines only, no ids), comic?: [{caption, imageUrl}]}`; `FORBIDDEN_SHARE_KEYS = ['person_id', 'email', 'pair_id']` |
| `operations/jobs.ts` | job names, payload schemas, `JobPayload<N>`, `Enqueue` and `maxAttempts` per job (2.3) |
| `operations/env.ts` | `apiEnv`, `workerEnv`, `migrateEnv` (2.6) |
| `operations/model-calls.ts` | `CallSite` enum (12 values), `LlmMode`, `RecordedCall {callSite, promptVersion, requestHash, request: {callSite, promptVersion, body}, response, usage, recordedAt, handWritten?}`; `requestHash` is the hash of `request.body` alone |
| `operations/operator-views.ts` | `Health {ok, db, worker, schemaVersion, diskPct, degraded}`; `ReplayExport {meetingId, exportedAt, events: MeetingEvent[]}` |
| `routes/people.ts`, `routes/sources.ts`, `routes/cards.ts`, `routes/meetings.ts`, `routes/briefs.ts` | request and response schema per route (2.2), grouped by the feature that serves it; both apps import from here; `routes = {people, sources, cards, meetings, briefs}`, so a caller writes `routes.sources.createSource.path` |

## 2. Routes

| Route | Request | Response | Notes |
|---|---|---|---|
| `POST /api/people` | `PersonCreate` | 201 `PersonCreateResponse` + `Set-Cookie` | public; rate limit 10 per IP per hour (R9.5); recovery code shown once |
| `POST /api/sessions/recover` | `Recover` | `{personId}` + `Set-Cookie`; 404 when unknown or used | public; single use (A5) |
| `POST /api/sessions/transfer` | none | `TransferResponse` | 128-bit, 10 min (R9.2) |
| `POST /api/sessions/claim` | `TransferClaim` | `{personId}` + `Set-Cookie`; 409 when used or expired | public |
| `POST /api/sources` | NDJSON body, `Content-Encoding: gzip`, `bodyLimit` 21 MiB | 201 `{sourceId, turnCount, redactionCount, duplicate}`; 413 over caps; 422 on 0 turns | duplicate hash returns the first id with `duplicate: true` (D8) |
| `GET /api/sources/:id?page=n` | none | `SourceView` | names grouped by role token, 20 per page (R2.4) |
| `POST /api/sources/:id/names-review` | `NamesReview` | `{frozenAt, redactionCount}` | sets `frozen_at` (D16) |
| `POST /api/sources/:id/cards` | none | 202 `{cardId}`; 409 when not frozen; 429 over 2 per source per day | enqueues `build_card` |
| `GET /api/cards/:id` | none | `CardView` | polled every 3 s while building (R3.4) |
| `GET /api/cards/:id/items/:position/source` | none | `CardItemSource`; 404 when missing or not yours | the owner's card screen only: a tapped quote shows its source message with the quote marked (R3.2) |
| `POST /api/cards/:id/approve` | `CardApprove` | `{state: 'approved'}` | |
| `POST /api/cards/:id/quiz` | none | 202 `{quizId}`; 409 when thin | enqueues `answer_quiz` |
| `GET /api/quizzes/:id` | none | `QuizView` | persona answers omitted until human answers (R4.2) |
| `POST /api/quizzes/:id/answers` | `QuizAnswers` | 202 `{state}` | enqueues `judge_quiz` |
| `POST /api/pairs` | none | 201 `PairCreateResponse` | token in URL as QR (D32) |
| `POST /api/pairs/join` | `PairJoin` | `{pairId}`; 409 when used, expired or own pair | one conditional UPDATE (R9.3) |
| `GET /api/pairs/:id` | none | `PairView` | lobby polls every 5 s (D54) |
| `POST /api/pairs/:id/meetings` | `MeetingCreate` | 201 `{meetingId}`; 429 over 5 per day | free text enqueues `check_question` |
| `GET /api/meetings/:id` | none | `MeetingView` | |
| `POST /api/meetings/:id/ready` | none | `{ready: true}` | |
| `POST /api/meetings/:id/start` | none | `{state: 'running' | 'queued', queuePosition?}`; 409 unless both ready, both connected within 30 s, question checked | `claim_meeting_slot` (R5.3, R5.9, D53) |
| `GET /api/meetings/:id/events` | header `Last-Event-ID` | SSE stream | section 6 of ARCHITECTURE.md |
| `GET /api/meetings/:id/events?after=seq` | none | `{v, events, partial, serverNow}` | the poll fallback (D49) |
| `POST /api/asks/:id/answer` | `{answer}` | `{state: 'answered'}`; 409 `{state: 'expired', storedAsLate: true}` | conditional UPDATE (R5.6); this 409 is the one error body that is not `ErrorBody` |
| `GET /api/meetings/:id/brief` | none | `Brief` (the caller's) ; 404 until ready | |
| `POST /api/meetings/:id/comic` | `ComicRequest` | 202 `{comicId}` | after `brief.ready` only |
| `GET /api/meetings/:id/comic` | none | `ComicView` | |
| `GET /api/comics/:id/panels/:position` | none | `image/webp` | |
| `POST /api/meetings/:id/consent` | none | `{consentA, consentB, published, slug?}` | snapshot built at the second consent (D68) |
| `DELETE /api/meetings/:id/consent` | none | `{published: false}` | revocation is a 404 on the next public read |
| `GET /api/share/:slug` | none | `ShareSnapshot`; 404 | public; `Cache-Control: no-store` |
| `GET /share/:slug` | none | the web app HTML | public |
| `DELETE /api/people/me` | none | 202 `{deletionId}` + cookie cleared | enqueues `delete_person` (D69) |
| `GET /api/health` | none | `Health` | public |
| `GET /*` | none | web app, SPA fallback, hashed assets cached | CSP header (D67) |

## 3. Jobs and events

Jobs (IMPLEMENTATION.md 2.3). The `max_attempts` value is set on every enqueue. Every payload carries the id its context needs before the first read (D55): `personId` for the `withPerson` jobs, `meetingId` for the `withMeeting` jobs.

| Job | Payload | max_attempts | run_at / key | Context | What it does |
|---|---|---|---|---|---|
| `scrub_names` | `{sourceId, personId}` | 2 (D15) | now | `withPerson` | chunks of 100,000 chars, effort minimal, writes role tokens and `redactions`, tags sensitive categories |
| `build_card` | `{cardId, personId}` | 2 (R3.5) | now | `withPerson` | 600,000-char whole-turn sample, card prompt, `verifyQuote`, one regeneration, thin marking, `chars_per_token` |
| `check_question` | `{meetingId}` | 2 (default) | now | `withMeeting` | minimal call; sets `question_checked_at` or `question_rejected_reason` |
| `answer_quiz` | `{quizId, personId}` | 2 (default) | now | `withPerson` | 10 persona answers at effort low; state to `waiting_human` |
| `judge_quiz` | `{quizId, personId}` | 2 (default) | now | `withPerson` | blind A/B, 2 calibration pairs, rerun once, `reliable` |
| `meeting_step` | `{meetingId, stepSeq}` | 1 (D59: fails closed to stalled) | now; no job key (D45) | `withMeeting` | claim row, two-call turn, tools, one-transaction commit, next step enqueue |
| `ask_timeout` | `{askId, meetingId}` | 5 (D35) | `run_at = deadline_at`; key `ask_timeout:{askId}` | `withMeeting` | expiry UPDATE, `ask.expired`, re-enqueue the step |
| `write_briefs` | `{meetingId}` | 2 (default) | now | `withMeeting` | brief per side, support judge per brief, `brief.ready` |
| `render_comic` | `{comicId, meetingId}` | 1 (D64: all 6 or failed) | now | `withMeeting` | panels prompt, scrubber on the final prompt, 6 parallel image calls, `comic.ready` or `comic.skipped` |
| `delete_person` | `{personId}` | 5 (default) | now | `withPerson` | state deleted, meetings deleted, cascades, ledger nulls, counts |
| `sweep_stalled` | cron `* * * * *` | 1 | | `withMeeting` per meeting | 150 s rule, queue promotion, token stop, heartbeat row |
| `purge_expired` | cron `0 * * * *` | 1 | | per-table | transfer links, expired unjoined pairs, comics past 30 days unless shared |

Events (IMPLEMENTATION.md 2.4). Every event has `v: 1`, `type`, `meetingId` and `at`. Committed events also have `seq`. A writer stores `{meeting_id: event.meetingId, seq: event.seq, type: event.type, v: event.v, payload: eventToPayload(event), created_at: event.at}`, so a replayed event has the same `at` as the live one; readers rebuild it with `rowToEvent(row)`.

| Type | Payload | Written by |
|---|---|---|
| `meeting.started` | `{startedAt, endsAt, question, members: [{side, displayName}]}` | start route |
| `phase.changed` | `{phase, stepSeq}` | step job |
| `turn.delta` | `{stepSeq, attempt, side, offset, text}` | SSE route from `partial_text` |
| `turn.committed` | `{stepSeq, side, phase, text, claims: Claim[]}` | step job, same transaction as `done` |
| `tool.called` | `{stepSeq, side, tool, args}` | step job |
| `tool.result` | `{stepSeq, side, tool, result}` | step job |
| `ask.opened` | `{askId, stepSeq, side, question, deadlineAt, serverNow}` | step job |
| `ask.answered` | `{askId, stepSeq}` | answer route |
| `ask.expired` | `{askId, stepSeq, text}` | ask_timeout job |
| `concede` | `{stepSeq, side, claimId, reason}` | step job |
| `hold` | `{stepSeq, side, reason}` | step job |
| `meeting.ended` | `{reason: 'decided' | 'budget' | 'deleted', endedAt}` | step job or sweeper |
| `brief.ready` | `{supportRate: {a, b}}` | write_briefs |
| `comic.ready` | `{comicId}` | render_comic |
| `comic.skipped` | `{comicId, reason}` | render_comic |

## 4. Code interfaces between builders

Frozen here so Wave 1 builders do not invent them. A name that is not in `packages/contracts` yet is marked in the code that uses it.

```ts
// packages/db (database builder)
export type Database = { people: PeopleTable; sessions: SessionsTable; /* one interface per table of 0001, snake_case columns, Generated<> on defaults */ };
export function makeDatabase(url: string, poolSize: number): Kysely<Database>;        // pool sizes: api 10, worker 8 (D56)
export function withPerson<T>(db: Kysely<Database>, personId: string, run: (trx: Transaction<Database>) => Promise<T>): Promise<T>;   // BEGIN; SET LOCAL app.person_id; run; COMMIT
export function withMeeting<T>(db: Kysely<Database>, meetingId: string, run: (trx: Transaction<Database>) => Promise<T>): Promise<T>; // BEGIN; SET LOCAL app.meeting_id; run; COMMIT
export function parseDatabaseError(error: unknown): { code: string; message: string } | null;   // reads "code: sentence" off a trigger RAISE; unique_violation -> "duplicate"
export function searchRecallCorpus(trx: Transaction<Database>, args: { cardId: string; query: string; limit: 5 }): Promise<Array<{ turnId: string; text: string }>>;  // tsvector('simple') then trigram fallback (D38); raw SQL allowed here only
export function nextEventSeq(trx: Transaction<Database>, meetingId: string): Promise<number>;   // SELECT coalesce(max(seq),0)+1 ... FOR UPDATE on the meeting row
export const SCHEMA_VERSION = 1;
// packages/db/src/testing
export function freshTestDatabase(): Promise<{ db: Kysely<Database>; migrateUrl: string; apiUrl: string; workerUrl: string; drop: () => Promise<void> }>;  // applies every migration to DATABASE_URL_TEST
export function asPerson<T>(db, personId, run): Promise<T>;  export function asMeeting<T>(db, meetingId, run): Promise<T>;   // same as withPerson/withMeeting, named for tests
export function withNoContext<T>(db, run): Promise<T>;   // a transaction with both settings unset, for the zero-rows tests
export function createTestPerson(db, displayName: string): Promise<{ personId: string; sessionToken: string; recoveryCode: string }>;
export function createFrozenSource(db, personId: string, turns: string[]): Promise<{ sourceId: string; turnIds: string[] }>;
export function createApprovedCard(db, sourceId: string, options?: { recallAllowed?: boolean; items?: number }): Promise<{ cardId: string; itemIds: string[] }>;
export function createPairedMeeting(db, options?: { questionId?: number }): Promise<{ meetingId: string; pairId: string; a: { personId: string; cardId: string; sessionToken: string }; b: {...} }>;

// packages/contracts (frozen in Wave 0): both apps import these two, and neither app declares its own copy
export type JobPayload<N extends JobName> = z.infer<(typeof JobPayloads)[N]>;
export type Enqueue = <N extends JobName>(name: N, payload: JobPayload<N>, options?: { runAt?: Date; jobKey?: string }) => Promise<void>;   // always passes JOB_MAX_ATTEMPTS[name]; a job key only for ask_timeout (D45)

// apps/api (api-shell builder); every other api builder registers routes through this shape, from apps/api/src/app-types.ts
declare module "fastify" { interface FastifyRequest { personId: string | null } }   // set by the sessions plugin from the cookie; null when absent
export type RouteDeps = { db: Kysely<Database>; env: ApiEnv; now: () => Date; enqueue: Enqueue };
export type RoutePlugin = (app: FastifyInstance, deps: RouteDeps) => Promise<void>;   // each feature folder exports one: registerSourcesRoutes, registerCardsRoutes, registerQuizRoutes, registerMeetingsRoutes
export function requirePerson(request: FastifyRequest): string;   // throws session_missing (401) when personId is null; exported from apps/api/src/sessions
// apps/api/src/testing
export function buildTestApp(options?: { routes?: RoutePlugin[]; env?: Partial<ApiEnv> }): Promise<{ app: FastifyInstance; db: Kysely<Database>; close: () => Promise<void> }>;
export function cookieJar(): { header: () => Record<string, string>; absorb: (response: LightMyRequestResponse) => void };
export function readSse(response: ReadableStream<Uint8Array>, options: { untilSeq?: number; timeoutMs: number }): Promise<Array<{ id: string | null; event: string; data: string } | { comment: string }>>;

// apps/worker (the runner is owned by the dossier builder in Wave 1 [confirm]; each feature folder exports its task list)
// these four live in apps/worker/src/job-context.ts; Enqueue and JobPayload come from packages/contracts
export type JobTask<N extends JobName> = (payload: JobPayload<N>, context: JobContext) => Promise<void>;
export type JobContext = { db: Kysely<Database>; env: WorkerEnv; now: () => Date; enqueue: Enqueue; llm: LlmClient; log: Logger };
export type TaskList = { [N in JobName]?: JobTask<N> };   // apps/worker/src/cards exports cardTasks, quizzes exports quizTasks, meetings exports meetingTasks, and so on; runner.ts spreads them
// apps/worker/src/testing (owned with the runner [confirm])
export function runJobOnce(context: JobContext, name: JobName, payload: unknown): Promise<void>;   // runs one task inline with the real database, no Graphile
export function fakeClock(start: Date): { now: () => Date; advance: (ms: number) => void };          // a fake; tests that use it say so
export function loadRecordedReply(callSite: CallSite, requestHash: string): RecordedCall;

// packages/llm (dossier builder; the shape is frozen here so quiz and meeting-engine can code against it)
export type LlmClient = {
  complete: (args: { callSite: CallSite; promptVersion: string; messages: ChatMessage[]; schema?: { name: string; strict: true; schema: Record<string, unknown> }; tools?: ToolDefinition[]; promptCacheKey?: string; ledger: { personId: string | null; meetingId: string | null } }) => Promise<{ text: string | null; parsed: unknown; toolCalls: ToolCall[]; finishReason: "stop" | "length" | "tool_calls"; usage: RecordedCall["usage"]; ledgerId: string }>;
  stream: (args: /* same */ & { onDelta: (text: string) => Promise<void>; onFirstToken: () => Promise<void> }) => Promise</* same result */>;
  image: (args: { callSite: "comic_image"; prompt: string; ledger: {...} }) => Promise<{ webp: Uint8Array; ledgerId: string }>;
};
// The client takes no transaction. It writes and finishes every ledger row in its own short transaction (withPerson when
// ledger.personId is set, withMeeting when only ledger.meetingId is set, no context only for self_test), so the row is
// committed before the call and every worker's limiter sees it. A caller never holds a transaction open across a model call.
// CALL_SITE_CONFIG[site].retries is the Retries column of ARCHITECTURE.md section 8 (the first-token retry for speech, the
// receipts regeneration, the one retry of a structured call); the two retries on 429 and 5xx (D59) are separate, in retries.ts.
// The self-test body for each schema is exactly { model: "muse-spark-1.3", messages: [{ role: "user", content: "ok" }],
// max_tokens: 1, response_format: { type: "json_schema", json_schema: toStrictJsonSchema(schema, name) } }, in that key order;
// the nine fixture files are named by its hash (R3.1-T6 in packages/llm).
export class LimiterBusy extends ContractError {}   // code limiter_busy; the job re-enqueues itself at now + 5 s (D58)
export class CapReached extends ContractError {}    // code daily_cap_reached or total_cap_reached, with the copy of D60
```

## 5. Error codes shared by every builder

| Code | Status | Sentence the user sees |
|---|---|---|
| `session_missing` | 401 | Sign in again from the start page. |
| `origin_mismatch` | 403 | Open the app from its own address and try again. |
| `not_found` | 404 | This no longer exists or is not yours. |
| `payload_invalid` | 400 | The request body did not match the expected shape. Reload and try again. |

Every route error body has the shape `ErrorBody` from `packages/contracts/src/operations/errors.ts`, except the 409 of `POST /api/asks/:id/answer` (section 2). Two more codes are server faults with status 500: `event_row_invalid` (a stored event no longer matches its schema) and `ledger_row_missing` (a ledger row could not be finished).

## 6. Trigger messages

A trigger in `0001_foundation.sql` raises a message that starts with a stable code, a colon, then a sentence. `parseDatabaseError` reads the code off the front. The codes raised by the triggers are:

- `turn_text_frozen`, `card_source_not_frozen`, `card_item_foreign_turn`, `claim_foreign_turn`, `meeting_bad_transition`, `prefix_frozen`, `event_seq_gap`, `ask_budget_spent`, `ask_not_due`.

`meeting_create` raises `pair_not_joined`, `card_not_approved` and `other_card_missing`. That makes twelve codes in all.

## 6a. Who may read and write what, as built

These are the rules of `0001_foundation.sql` after the Wave 0 check. A builder relies on them and never works around them.

- `people`: a person sees and changes only their own row; a meeting job sees both members. The other person's display name comes only from `SELECT * FROM pair_display_names(pairId)` (columns `creator_display_name`, `joiner_display_name`), inside `withPerson`. That is how `PairView`, `MeetingView.members[].displayName` and `MeetingStarted.members` get the other name.
- `asks` and `briefs`: inside `withPerson` a person sees only their own rows (`person_id`); a meeting job sees both sides. A feature that needs both briefs, such as the share snapshot, reads them inside `withMeeting`.
- `meeting_members`: `app_api` may not read `frozen_prefix`, because it holds a person's approved card items and quiz misses. API code names its columns and never selects all of them; a route that needs to know whether the prefix exists reads `frozen_prefix_tokens`. The worker reads and writes the prefix.
- `ledger`: `app_api` may only read it; the worker writes every row. A worker with no context may write, read back and finish a row only when it is a `self_test` row with no person and no meeting.
- The fifteen SECURITY DEFINER functions are owned by `app_definer`, and PUBLIC may run none of them. `app_api` may run the four `auth_*` functions, `pairs_join`, `share_read`, `claim_meeting_slot`, `meeting_create`, `pair_display_names` and `app_shares_meeting`. `app_worker` may run `ledger_window`, `ledger_usd_since`, `ledger_meeting_tokens`, `claim_meeting_slot`, `sweep_candidates`, `purge_expired_rows` and `app_shares_meeting`. `app_shares_meeting` exists only for the `meeting_members` policy.
- `sweep_candidates(stale_seconds)` returns `(meeting_id, kind, queue_position)`, ordered by kind and then queue position, so the sweeper promotes the lowest queued position first.
- The `graphile_worker` grants in 0001 run on an empty schema. The database builder's migrate runs Graphile's own migrations as `app_migrate` and then grants `app_worker` and `app_api` what they need (api-shell request 001).
- Running 0001 needs `app_migrate` to own the database and hold CREATEROLE. Locally: `createdb -O app_migrate <name>`, then `CREATE SCHEMA graphile_worker AUTHORIZATION app_migrate`, then the file as `app_migrate`. On Render the operator does the same by hand before the first migrate.

## 7. The freeze

After the `contracts-frozen` tag, every change to `packages/contracts`, `0001_foundation.sql`, `packages/receipts` or the three `packages/llm` files is a `requests/` file to the integrator (D75).
