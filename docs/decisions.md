# The decision ledger

This table is ARCHITECTURE.md section 10, copied verbatim except for the lines marked "Changed as built", which name the as-built item that changed a row; every constant in code names its row (R13.5). The reconciled defaults marked "confirm" in ARCHITECTURE.md and IMPLEMENTATION.md are listed after the amendments with the value the code uses.

| # | Decision | Value | Reason | What breaks if wrong | Breaks at | Cost to change later | Amended |
|---|---|---|---|---|---|---|---|
| D1 | Where extraction runs | browser Web Worker; server accepts only canonical NDJSON | zip bombs, 400 MB JSON and third-party turns never reach the server; raw file stays on the device | worker OOM; AUP exposure to other speakers' text | T0, T3 | high: server parser plus storage of raw | no |
| D2 | Zip size cap (client) | 150 MB | above this a phone browser cannot hold a conversation object | tab crash with no message | T1 | low | no |
| D3 | Inflated byte cap | 1.5 GB, counter in the fflate stream | zip bomb stops at a number, not at OOM | tab dies at 40 GB | T0 | low | no |
| D4 | Upload body | gzip via CompressionStream, decoded max 20 MiB, compressed max 8 MiB, route `bodyLimit` 21 MiB | Fastify default `bodyLimit` is 1 MiB; mobile data cost 5x lower | 413 on every real export | T0, T1 | low | no |
| D5 | Turns per source | max 10,000, max 20,000 chars each, max 2 MiB canonical text; browser ranks by persona_signal then recency | storage at 10,000 users stays under 20 GB; card input is capped anyway | Postgres disk fills | T3 | medium: re-upload required | no |
| D6 | Canonicalisation | strip BOM, CRLF to LF, NFC, strip Unicode Cf and Cc except \n and \t | offsets stable; hidden text and bidi tricks cannot survive | quote match fails; invisible injections | T0, T4 | high: offsets change | no |
| D7 | Offsets | UTF-16 code units of stored canonical text, computed in JS only | one definition, one place | highlights drift | T0 | high | no |
| D8 | Duplicate upload | `UNIQUE (person_id, content_hash)`, hash = sha256 of canonical turns | second upload returns the first | doubled persona | T1 | low | no |
| D9 | Zero own turns | hard error client-side before POST | silent empty persona is the worst outcome | user approves nothing and blames the product | T0 | low | no |
| D10 | Paste | one source kind; blank-line blocks are turns | same Turn type, same receipts | separate code path without quotes | T2 | low | no |
| D11 | Scrub gate | deterministic `packages/scrub` runs in browser (preview) and in API (authoritative, writes `redactions`) | client cannot be trusted; count equals `COUNT(*)` | count lies; secret stored | T0 | medium | no |
| D12 | Entropy rule | tokens 20 chars or more, entropy over 3.5 bits per char, no whitespace | catches keys with unknown prefixes | leaked key | T0 | low | no |
| D13 | Code fences | stored as `[code: lang, n lines]`, never verbatim | .env in a fence has nothing to leak | key reaches model | T0 | low | no |
| D14 | Redaction placeholder | `[redacted:category:8hex]`, no offsets stored | text is rewritten twice (regex, names), offsets would drift | wrong highlights | T0 | low | no |
| D15 | Names pass | worker job, chunks of 100,000 chars, effort minimal, strict JSON `{names:[{text, role}]}`, 60 s per chunk, 2 attempts | AUP forbids third parties' private data downstream | name reaches the other human | T2, T3 | medium | no |
| D16 | Names review | `sources.frozen_at` set by the user's review; `turns.text` immutable after `frozen_at` (trigger); `build_card` requires `frozen_at IS NOT NULL` | card offsets are computed on text that can no longer change | drifted quotes | T0, T4 | high | no |
Changed as built: item 30.
| D17 | Allowlist | own display name and declared affiliations; organisations never scrubbed | persona survives | "[NAME] from [ORG]" | T0 | low | no |
| D18 | Sensitive categories | health, minors, addresses, contacts, identifiers; excluded from card and recall unless opted in per category | AUP and the user's own expectation | diagnosis in a quote | T1 | low | no |
| D19 | Card input cap | 600,000 chars by whole turns; sampler 50% recency, 50% keyword diversity | 1M context never filled even at 3 chars per token | 400 context exceeded | T0 | low | no |
| D20 | Chars per token | calibrated from the first call's `usage.prompt_tokens`, stored per source | Tamil is 3x English | overrun on retry | T1 | low | no |
| D21 | Card schema | strict json_schema, items 6 to 40, each `{kind, claim, lang, gloss, turn_id, quote}`; kinds enum value, preference, habit, boundary, goal | depth and no anyOf keep strict mode happy | 400 at first card | T0 | low | no |
| D22 | Card call | effort medium, `max_tokens` 16,000, timeout 240 s, 1 retry, `maxRetries 0` in the SDK | SDK default timeout is 10 minutes and 2 hidden retries | triple cost, 20 min stall | T0, T2 | low | no |
| D23 | Thin card | fewer than 6 verified items marks card thin, quiz skipped, meeting allowed with badge | honest copy beats a fake persona | 8 variations of "likes Python" | T1 | low | no |
| D24 | `normQuote` | NFC, casefold, curly quotes and dashes to ASCII, ASCII whitespace runs to one space, trim leading and trailing punctuation | models alter case and quotes | every match fails | T0 | medium: recompute column | no |
| D25 | Quote minimum | 20 normalised chars, or 10 code points for text with no spaces (CJK); never a substring of the question or prompt | "I think so" matches everything | fabricated receipts | T3 | low | no |
| D26 | Quote scope | within the named `turn_id` only; speaker's own source only | cross-turn and cross-person matches impossible | A quotes B | T0 | low | no |
| D27 | Regeneration | exactly 1, of the receipts call only | bounded cost, bounded delay | loop | T2 | low | no |
| D28 | Quiz bank | 30 fixed questions in `packages/contracts/quiz-bank.ts`, 10 sampled with seed `card_id` | generated questions leak the card | trivial matches | T0 | low | no |
| D29 | Quiz order | `quiz_items.human_answer` has a CHECK requiring `persona_answer IS NOT NULL` | human cannot peek | inflated score | T1 | low | no |
| D30 | Judge | strict JSON `{agree: boolean, reason}`, temperature 0, randomised A/B per item, 2 calibration pairs; failed calibration reruns once then marks unreliable | bounded variance | 8/10 for everyone | T3 | low | no |
| D31 | Score display | "matched n of 10", misses injected into the meeting prompt as "ask, do not guess" | no percentage | distrust | T1 | low | no |
| D32 | Invite | 128-bit token in URL, sha256 stored, single use, 24 h expiry, QR shown | 6-char codes enumerate | pair hijack | T3 | low | no |
| D33 | Session | 256-bit token, sha256 stored, 90 days; transfer link 128-bit, 10 min, single use | in-app webviews have their own storage | joiner loses persona switching to Safari | T1 | low | yes: the token lives in the HttpOnly `__Host-session` cookie, not localStorage (decision 9); a 32-character single-use recovery code is added (PLAN section 0) |
| D34 | Agenda | open 2 turns, explore up to 6, decide 2, close; strictly alternating; explore cutoff at 8:00 from `started_at`; `ends_at` 10:00; decide always runs | two asks at once impossible; decision guaranteed | no decision | T2 | medium | no |
Changed as built: item 28.
| D35 | Ask | 90 s, `deadline_at` server time, `ask_timeout` job at `run_at = deadline_at` with `max_attempts 5`; resolution is `UPDATE asks SET state=$1 WHERE id=$2 AND state='pending'`; expiry also requires `deadline_at <= now()`; budget 2 per side, 1 per turn, enforced by removing the tool | whichever wins, the other is a 409 no-op | double resolution | T2 | low | no |
Changed as built: item 28.
| D36 | Ask when human absent | expiry text "my human is away, going with what I know"; late answer stored in `asks.late_answer` and injected next turn | honest, no stall | frozen meeting | T1 | low | no |
Changed as built: item 28.
| D37 | Tool rounds | 4 per turn; the 5th request carries no `tools` field | `tool_choice` is auto only | recall forever | T0 | low | no |
| D38 | Recall | Postgres `tsvector('simple')` plus trigram fallback over the speaker's recall corpus, top 5 turns, 600 chars each | no embeddings endpoint | nothing to cite | T0 | medium | no |
| D39 | Turn structure | 2 calls: speech (tools, streamed plain text, effort low, `max_tokens` 6,000, first token 45 s, total 120 s; raised from 20 s and 90 s on 27 Oct 2026 after a live call took 10.2 s to its first word, because Muse Spark streams nothing while it reasons) then receipts (no tools, strict JSON claims, effort minimal, `max_tokens` 2,000, 30 s) | tools plus json_schema in one request is unverified on Meta; streamed JSON cannot be shown live | 400 or braces on screen | T0 | medium | no |
| D40 | Prompt cap | 60,000 tokens per request; all prior committed turns (max 10); drop oldest explore turns first | bounded cost | 200k-token turn | T3 | low | no |
| D41 | Prefix cache | `meeting_members.frozen_prefix` immutable after start (trigger); `prompt_cache_key = meeting:{id}:{side}`; variable data only after the prefix | cache hits every turn | 3x input cost | T2 | low | no |
| D42 | Decide turn | tools `concede`, `hold` only; no call means `hold` with reason "no explicit decision" | state machine always finishes | hung meeting | T2 | low | no |
| D43 | Refusal | empty content becomes "I'd rather my human speak to this" plus an ask if budget remains | no blank turn | crash look | T2 | low | no |
Changed as built: item 28.
| D44 | Idempotent step | `meeting_steps (meeting_id, step_seq) UNIQUE`; job claims with `UPDATE ... SET state='running', attempt=attempt+1 WHERE state IN ('pending','stalled') RETURNING`; model result committed in the same transaction as `turn.committed` | Graphile `replace` on a locked job schedules a second runner | duplicated turn | T2 | high | no |
| D45 | Job keys | `ask_timeout:{ask_id}` only; `meeting_step` has no key | completed jobs are deleted and keys are not a log | false idempotency | T2 | low | no |
Changed as built: item 28.
| D46 | Stalled sweeper | cron every minute: meetings `running` with no event for 150 s get a new `meeting_step` job; a stale job resuming finds the step done | SIGKILL leaves a Graphile job locked (lock timeout unverified) | meeting frozen for hours | T2 | low | no |
Changed as built: item 31.
| D47 | Delta storage | `meeting_steps.partial_text` flushed every 250 ms, NOTIFY payload `meeting_id:step_seq:attempt:len`; since 27 Oct a round that called a tool leaves the partial text when it ends and is never part of the turn | no delta rows; reconnect mid-turn shows text; no words about a tool call on screen | blank 20 s or 10M rows | T1, T3, W3-SPEECH-T1 | low | no |
| D48 | NOTIFY | one channel `meeting_events`, payload under 100 bytes (limit 8,000 bytes); one LISTEN connection per API process; subscribers re-read under their RLS | delivered on commit, ordered | lost events or cross-pair reads | T3 | low | no |
| D49 | Poll fallback | SSE first byte within 5 s or client polls `?after=seq` every 2 s; the server also runs a 10 s safety poll per SSE subscriber | Render proxy buffering is undocumented; LISTEN connection drops lose notifications | frozen screen | T2 | low | no |
| D50 | SSE headers | `text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, compression plugin excluded, 2 KB comment padding, `reply.hijack()` | proxies and compressors buffer | buffering | T2 | low | no |
| D51 | Reconnect | backoff 1 s doubling with jitter, cap 30 s; reconnect on `visibilitychange`; 3 connections per person per meeting, oldest closed | storms and iOS tab kills | API restart storm | T1 | low | no |
| D52 | Replay | `WHERE seq > $1`; Vitest asserts first replayed is last+1 | off-by-one | duplicated event | T0 | low | no |
| D53 | Presence | `meeting_members.last_seen_at` updated on each heartbeat; start requires both within 30 s | a human who is not there cannot be asked | ask expires on stage | T2 | low | no |
Changed as built: item 28.
| D54 | Lobby | `GET /pairs/:id` polled every 5 s, no SSE | SSE only for meeting rooms | 10,000 idle connections | T3 | low | no |
| D55 | RLS context | `app.person_id` for requests and single-person jobs, `app.meeting_id` for meeting jobs; `current_setting(..., true)` NULL yields zero rows | fail closed | cross-pair read | T0 | high | no |
| D56 | Pools | api 10, worker 8, LISTEN 1 per process | Render Postgres connection limit unverified | connection refused | T3 | low | no |
| D57 | Concurrency | worker concurrency 16; `MAX_CONCURRENT_MEETINGS` 40, others wait in `queued` with position | 4M TPM at 15k tokens per turn, 3 turns a minute | 429 cascade | T3 | low | no |
| D58 | Limiter | before each call: `SUM(est_tokens)` over `ledger` rows in the last 60 s must stay under 3,000,000 and calls under 2,000; otherwise job re-enqueues at now + 5 s | DB-backed, survives 2 workers | in-process limiter lies | T3 | low | no |
| D59 | Retries | 429 and 5xx: 2 retries, jitter 200 to 800 ms, `retry-after` honoured up to 10 s; after that the step fails closed to a stalled state picked up by the sweeper | a 4th retry is 30 s of silence | demo "crash" | T2 | low | no |
| D60 | Caps | `DAILY_USD_CAP` 40, `TOTAL_USD_CAP` 130, per person 3 sources, 2 cards per source per day, 5 meetings per day, 10 accounts per IP per hour | credits unverified at $150 per participant | credits gone Sunday | T3 | low | no |
| D61 | Per-meeting token stop | 1,500,000 tokens; then `meeting.ended {reason: budget}` | one meeting cannot burn the day | $6 meeting | T3 | low | no |
| D62 | Effort per call site | scrub minimal, judge minimal, receipts minimal, quiz low, turn low, card medium, brief medium | reasoning is billed as output | 10x cost | T0 | low | yes: adds brief support judge at minimal, temperature 0 (PLAN section 0) |
| D63 | `finish_reason length` | discard, retry once with effort minimal and `max_tokens` 8,000; then fallback template | partial JSON | parse crash | T2 | low | no |
| D64 | Comic | 6 parallel image calls, 1024x1024, style prefix plus avatar descriptors from 6 fixed options, 30 s each, 60 s total, all 6 or `failed`, webp 150 KB max per panel, purge after 30 days unless shared | grid panel counts are not controllable; muse-image 150 RPM | brief waits; bytea bloat | T1, T4 | low | no |
| D65 | Comic prompt | fixed template plus brief headlines; deterministic scrubber runs on the final prompt and refuses on any hit | "Priya, 7, asthma" | AUP | T2 | low | no |
| D66 | Markdown | text, emphasis, lists, blockquote only | exfil via image URL | leak | T0 | low | no |
| D67 | CSP | `default-src 'self'; img-src 'self' data:; connect-src 'self'` | belt and braces | leak | T0 | low | yes: `connect-src` loses `API_ORIGIN` under one origin (decision 9) |
| D68 | Share | snapshot JSON at second consent; served only while `consent_a AND consent_b`; `Cache-Control: no-store`; serializer test forbids keys `person_id, email, pair_id` | revocation is a 404 on the next request | leaked ids | T3 | low | yes: snapshot also excludes brief lines not marked supported (PLAN section 0) |
| D69 | Deletion | `people.state='deleted'` first, then FK cascades; `ledger.person_id` set null; `MeetingGone` is success | job loops on FK | retry forever | T3 | low | no |
| D70 | Render deploys | Auto-Deploy Off on production services, deploy hook with `ref` from a `release` branch, `demo-freeze` tag; shutdown delay 120 s (max 300) | push during demo | restart on stage | T2 | low | yes: two production services (api serving web, worker), not three (decision 9) |
| D71 | Migrations | pre-deploy command on the api service with `pg_advisory_lock`, 30 min limit; worker asserts schema version at boot | two migrators | half schema | T0 | low | no |
| D72 | Node | 22 via Dockerfile base image for api and worker | Render's version pick is unverified | wrong runtime | T0 | low | no |
| D73 | Env | one zod schema per app in `packages/contracts/src/env.ts`; names `DATABASE_URL_API, DATABASE_URL_WORKER, DATABASE_URL_MIGRATE, META_API_KEY, META_API_BASE_URL, LLM_MODE, APP_ORIGIN, DAILY_USD_CAP, TOTAL_USD_CAP, MAX_CONCURRENT_MEETINGS, LOG_LEVEL`; models are constants in `packages/llm/config.ts` | misnamed var at 3 AM | boot loop | T0 | low | yes: `API_ORIGIN` removed, `PORT` added (decision 9) |
| D74 | LLM modes | `LLM_MODE=live|record|replay`; production refuses `replay`; no fake gateway module; MSW only under `apps/web/src/testing`, `no-restricted-imports` elsewhere | mocks never swapped | demo on mocks | T2 | low | name only: `src/testing` per design-inputs/repo-structure-rules.md |
| D75 | Ownership | `packages/contracts` drafted by `contracts-author` in Wave 0 under human review, then edited only by the integrator through `requests/` | drift | 2 schemas | T0 (build) | low | no |

Amendment rows from PLAN.md section 0, with the same columns:

| # | Decision | Value | Reason | What breaks if wrong | Breaks at | Cost to change later |
|---|---|---|---|---|---|---|
| A1 | Support check | after `write_briefs`, one strict-JSON judge call per brief, temperature 0, blind, order-swapped; unsupported lines render "weak receipt" and are excluded from decide-first and the share page; reported as a support rate, never as proof | a matching quote proves provenance, not that it supports the line | a confident brief line with an unrelated quote on the share page | T1 | low: two columns, one call site |
| A2 | Seven eval metrics | evidence validity, grounded brief rate, support rate, injection leakage, end-to-end completion by fresh pairs, first-turn latency, cost per complete pair; targets are targets, README prints actuals and sample sizes | the three old numbers did not measure the product as used | README claims nobody can check | T2 | low |
| A3 | Consent copy | the verbatim sentence in section 7.6, shown with the scrub preview before upload | the raw archive truly stays on the device, so the copy may say so | copy promises more than the code does | T0 | low |
| A4 | Known limits | the seven plain-words limits in section 7.10 in `docs/known-limits.md` | judges and users read what it cannot do | over-claim | T2 | low |
| A5 | Recovery code | 32 characters, shown once at signup, sha256 stored, redeemable once; PLAN decision 4 default | an anonymous session needs one recovery path without email | lost phone, lost persona (R9.8 narrows to "both lost") | T1 | low |
| A6 | Human metrics | per real pair, asked privately: card represented you (1 to 5); any brief line felt unsupported (which); brief surfaced something worth discussing (1 to 5); would you use it before choosing a teammate; for known collaborators each friction point marked known-before-reveal or not, outcome definition fixed before the run | the product's only claim is that the card represents the person | an eval that measures a product we are not building | T2 | low |
| A7 | One origin | web served from the api service; session in `__Host-session` HttpOnly cookie; Origin check on non-GET; no static site, no CORS, no `API_ORIGIN`; API routes under `/api` | a bearer token in localStorage is readable by any injected script; two origins need CORS and a second Render service | token theft through the markdown or a dependency | T0 | medium: two services and CORS to add back |
| A8 | Ask delivery copy | "asks are delivered to the open meeting tab with sound, vibration and the Notification API where granted, and a meeting cannot start unless both humans are connected"; replaces "pings the real person's phone" | iOS suspends background tabs; web push without home-screen install is unverified | an ask that never arrives on stage | T1 | none: copy and the start precondition |
Changed as built: item 28.

## Defaults confirmed at the Wave 0 review

The 27 October 08:00 review result is not in the inputs, so each value below is the default the code uses today.

| Item | Value | Where it is used |
|---|---|---|
| check_question max attempts | 2 | JOB_MAX_ATTEMPTS in packages/contracts/src/operations/jobs.ts |
| answer_quiz max attempts | 2 | JOB_MAX_ATTEMPTS in packages/contracts/src/operations/jobs.ts |
| judge_quiz max attempts | 2 | JOB_MAX_ATTEMPTS in packages/contracts/src/operations/jobs.ts |
| write_briefs max attempts | 2 | JOB_MAX_ATTEMPTS in packages/contracts/src/operations/jobs.ts |
| delete_person max attempts | 5 | JOB_MAX_ATTEMPTS in packages/contracts/src/operations/jobs.ts |
| scrub_names output limit and timeout | 4,000 tokens; 60 seconds; 1 retry | CALL_SITE_CONFIG in packages/llm/src/call-sites.ts |
| question_check output limit and timeout | 200 tokens; 30 seconds; 1 retry | CALL_SITE_CONFIG in packages/llm/src/call-sites.ts |
| card output limit and timeout | 16,000 tokens; 240 seconds; 1 retry (D22) | CALL_SITE_CONFIG in packages/llm/src/call-sites.ts |
