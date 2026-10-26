# Request build/w2-deploy-and-docs-006: row ids on exported constants (61 misses)

Request build/w2-deploy-and-docs-006. File: the files listed below (each owned by the builder named in the path).

Change wanted:

Add a row id (D, A, R or invariant) in the three lines above each constant, naming the ledger row that gives the value, or narrow the rule with an explicit list. The 61 misses, by file:

- apps/api/src/cards/request-build.ts: CARD_PENDING_LABEL
- apps/api/src/job-queue.ts: ENQUEUE_FAILED_SENTENCE
- apps/api/src/meeting-stream/listen-fan-out.ts: MAX_INT_COLUMN LISTEN_CONNECT_TIMEOUT_MS
- apps/api/src/meetings/create-meeting.ts: MEETING_CREATE_REFUSALS
- apps/api/src/pairs/create-pair.ts: PAIR_JOIN_PATH
- apps/api/src/sessions/origin-check.ts: SAFE_METHODS
- apps/api/src/sessions/transfer.ts: TRANSFER_CLAIM_PATH
- apps/api/src/sources/upload.ts: INSERT_BATCH_ROWS
- apps/api/src/web-pages/health.ts: DISK_PLAN_BYTES
- apps/api/src/web-pages/spa-fallback.ts: HTML_CONTENT_TYPE INDEX_CACHE
- apps/web/src/app-shell/api-fetch.ts: NETWORK_FAILED_SENTENCE
- apps/web/src/app-shell/app-paths.ts: APP_PATHS ROUTE_PATTERNS CARD_QUERY SIDE_QUERY
- apps/web/src/app-shell/routes.tsx: APP_ROUTES
- apps/web/src/app-shell/screen-parts.tsx: COPIED_MS
- apps/web/src/extract/worker-entry.ts: WORKER_REFUSAL_CODES READING_PROGRESS_STEP_BYTES
- apps/web/src/screens/lobby/lobby-state.ts: MEETING_STATE_LABELS
- apps/web/src/screens/meeting/screen.tsx: ENDED_LINES
- apps/web/src/screens/meeting/transcript-view.tsx: AT_BOTTOM_PX PHASE_LABELS
- apps/web/src/screens/names-review/names-review-state.ts: OPT_IN_LABELS
- apps/web/src/screens/pair/pair-state.ts: QR_ERROR_CORRECTION QR_MARGIN_MODULES
- apps/web/src/screens/quiz/quiz-state.ts: QUIZ_POLL_MS
- apps/worker/src/meetings/prompt-builder.ts: CACHE_KEY_HASH_CHARS CLAIM_LABEL_PREFIX
- apps/worker/src/quizzes/quiz-fixtures.ts: FIXTURE_TURNS FIXTURE_CARD_ITEMS FIXTURE_PERSONA_ANSWERS FIXTURE_HUMAN_ANSWERS FIXTURE_HUMAN_ANSWER_6_VARIANT RUN_1_VERDICTS RUN_2_VERDICTS AGREE_REASON DISAGREE_REASON FIXTURE_QUIZ_IDS
- apps/worker/src/quizzes/quiz-requests.ts: QUIZ_STOP_SENTENCES
- apps/worker/src/runner.ts: TASKS
- packages/db/src/database-errors.ts: TRIGGER_CODES DUPLICATE_SENTENCE
- packages/db/src/fresh.ts: LOCAL_HOSTS
- packages/db/src/migrate.ts: MIGRATIONS_FOLDER
- packages/db/src/recall-search.ts: RECALL_QUERY_WORDS_MAX RECALL_TRIGRAM_MIN
- packages/llm/src/call-sites.ts: CALL_SITE_CONFIG
- packages/llm/src/config.ts: CHAT_PRICE IMAGE_PRICE
- packages/llm/src/modes.ts: FIXTURE_ROOT REPLAY_STREAM_SLICE_CHARS REPLAY_STREAM_SLICE_MS
- packages/prompts/src/current.ts: CURRENT_PROMPTS PROMPT_NAMES
- packages/prompts/src/read-prompt.ts: PROMPTS_ROOT
- packages/receipts/src/norm-quote.ts: QUOTE_FOLDS
- packages/scrub/src/identifier-patterns.ts: EMAIL
- packages/scrub/src/secret-patterns.ts: SECRET_ASSIGNMENT

```diff
 // D57: concurrency; 40 meetings run at once.
 export const MAX_MEETINGS = 40;
```

Why: the forbidden-imports job runs `pnpm tsx scripts/constants-name-rows.ts` over apps and packages, and rule R13.5 says every exported UPPER_CASE constant names its row; the job fails on the current main with 61 misses.

Until then: the constants step fails. The rule is not weakened in this worktree; its scope is the spec's..
