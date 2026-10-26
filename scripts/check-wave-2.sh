#!/usr/bin/env bash
# The integration check that gates Wave 3: check-wave-1 from the top, then the whole golden path, the replay eval, both Docker images,
# lint, the repo checks and the forbidden-import greps (specs/checks/check-wave-2.md). It never edits a source file, pushes or merges.
# Every command writes its output under docs/evidence/check-wave-2/ and a summary line, so a partial run is still readable.
set -euo pipefail

SELF="$0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SELF="$ROOT/scripts/check-wave-2.sh"
EVIDENCE="$ROOT/docs/evidence/check-wave-2"
SUMMARY="$EVIDENCE/summary.txt"
# --without-docker runs every row except the three that need Docker (18 to 20), records those as not run, and never prints
# "check-wave-2: pass", so the Wave 3 gate stays closed until a run with Docker passes (check-wave-2.md section 6).
WITHOUT_DOCKER=0

# Refuses to run unless the tree is merged, clean and set up. Each refusal names its reason and exits 2.
preconditions() {
  local tools="jq psql curl lsof docker"
  [ "$WITHOUT_DOCKER" = 1 ] && tools="jq psql curl lsof"
  for tool in $tools; do
    if ! command -v "$tool" >/dev/null; then
      echo "check_wave_tool_missing: $tool is not installed" >&2
      exit 2
    fi
  done
  # The evidence folder and eval/results.json are this check's own output, so a rerun does not count them as uncommitted changes.
  if [ -n "$(git -C "$ROOT" status --porcelain -- . ':!docs/evidence' ':!eval')" ]; then
    echo "check_wave_dirty_tree: commit or stash first; the check runs on the merged tree only" >&2
    exit 2
  fi
  # Each Wave 1 builder branch must be part of this tree; the integrator fast-forwards, so there are no merge commits to read.
  local builder
  for builder in database api-shell ingest dossier quiz meeting-engine web-shell; do
    if ! git -C "$ROOT" merge-base --is-ancestor "refs/heads/build/w1-$builder" HEAD 2>/dev/null; then
      echo "check_wave_nothing_merged: build/w1-$builder is not merged into this tree" >&2
      exit 2
    fi
  done
  # At least one Wave 2 builder must be merged; the ones that are not are named, so a partial run says what it covers. Every
  # build/w2 branch starts at the local tag wave-2-launch, so a branch counts as merged when it has moved past that tag and its tip is in this tree.
  local merged=0
  for builder in briefs comic share-and-consent deletion evals deploy-and-docs; do
    if git -C "$ROOT" merge-base --is-ancestor "refs/heads/build/w2-$builder" HEAD 2>/dev/null && [ "$(git -C "$ROOT" rev-parse "refs/heads/build/w2-$builder")" != "$(git -C "$ROOT" rev-parse refs/tags/wave-2-launch)" ]; then
      merged=$((merged + 1))
    else
      echo "check_wave_2_info: build/w2-$builder is not merged into this tree" >&2
    fi
  done
  if [ "$merged" -eq 0 ]; then
    echo "check_wave_nothing_merged: no build/w2 branch is merged into this tree" >&2
    exit 2
  fi
  if [ ! -f "$ROOT/.env.check" ]; then
    echo "check_wave_env_missing: copy .env.example to .env.check and fill the three database URLs" >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.check"
  set +a
  if [ "${LLM_MODE:-}" != "replay" ]; then
    echo "check_wave_2_needs_replay: this check runs on fixtures only; D74" >&2
    exit 2
  fi
  if [ "$(psql "$DATABASE_URL_MIGRATE" -Atc 'SELECT 1' 2>/dev/null || true)" != "1" ]; then
    echo "check_wave_database_unreachable: the migrate URL does not answer SELECT 1" >&2
    exit 2
  fi
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "check_wave_port_busy: stop the process on $PORT" >&2
    exit 2
  fi
  [ "$WITHOUT_DOCKER" = 1 ] && return 0
  if ! docker info >/dev/null 2>&1; then
    echo "check_wave_2_docker_down: start Docker; rows 18 and 19 need it" >&2
    exit 2
  fi
  if [ "$(df -k "$ROOT" | awk 'NR==2 {print $4}')" -lt 5000000 ]; then
    echo "check_wave_2_disk_low: the two Node 22 images need 5 GB free" >&2
    exit 2
  fi
}

# Command 01: the lockfile matches every merged package.json.
s01_install() { pnpm install --frozen-lockfile; }
# Command 02: every app compiles against the frozen contracts.
s02_typecheck() { pnpm -r typecheck; }
# Command 03: migrations apply from empty.
s03_database() { pnpm db:fresh; }
# Command 04: every table forces row-level security. The output must be exactly 0.
s04_forced_rls() {
  local count
  count=$(psql "$DATABASE_URL_MIGRATE" -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relforcerowsecurity")
  echo "$count"
  [ "$count" = "0" ]
}
# Command 05: the schema holds 27 tables in public: 25 from 0001 (asks dropped, as-built item 28) and 2 from 0002 (item 29).
s05_tables() {
  local count
  count=$(psql "$DATABASE_URL_MIGRATE" -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'")
  echo "$count"
  [ "$count" = "27" ]
}
# Command 06: the security definer functions are exactly the 16 of 0001 and 0003 (as-built items 6 and 34).
s06_definer_functions() {
  local count
  count=$(psql "$DATABASE_URL_MIGRATE" -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef")
  echo "$count"
  [ "$count" = "16" ]
}
# Command 07: the quiz bank is seeded with its 30 questions (D28).
s07_quiz_bank() {
  local count
  # Read as app_api, the role that reads the bank; the owner app_migrate sees no rows under forced row security.
  count=$(psql "$DATABASE_URL_API" -Atc "SELECT count(*) FROM quiz_bank WHERE bank_version = 1")
  echo "$count"
  [ "$count" = "30" ]
}
# Command 08: the whole tree builds.
s08_build() { pnpm -r build; }
# Command 09: the api and the worker boot and stay alive for 10 seconds.
s09_start_servers() {
  pnpm --filter api start > "$EVIDENCE/api.log" 2>&1 &
  echo $! > "$EVIDENCE/api.pid"
  pnpm --filter worker start > "$EVIDENCE/worker.log" 2>&1 &
  echo $! > "$EVIDENCE/worker.pid"
  sleep 10
  kill -0 "$(cat "$EVIDENCE/api.pid")"
  kill -0 "$(cat "$EVIDENCE/worker.pid")"
}
# Command 10: the database answers through the health route within 60 seconds.
s10_health_database() {
  for _ in $(seq 1 60); do
    if curl -fsS "$APP_ORIGIN/api/health" | jq -e '.db == true' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
# Command 11: the worker heartbeat appears within 150 seconds.
s11_health_worker() {
  for _ in $(seq 1 150); do
    if curl -fsS "$APP_ORIGIN/api/health" | jq -e '.worker == true' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
# Command 12: the web app is served at the root with its content security policy.
s12_root_page() {
  local answer
  answer=$(curl -sS -D "$EVIDENCE/12-root-headers.txt" -o /dev/null -w '%{http_code} %{content_type}\n' "$APP_ORIGIN/")
  echo "$answer"
  [ "$answer" = "200 text/html; charset=utf-8" ]
  grep -iq "^content-security-policy: default-src 'self'; img-src 'self' data:; connect-src 'self'" "$EVIDENCE/12-root-headers.txt"
}
# Command 13: an unknown client route gets the app shell.
s13_spa_fallback() {
  local answer
  answer=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "$APP_ORIGIN/share/not-a-real-slug")
  echo "$answer"
  [ "$answer" = "200 text/html; charset=utf-8" ]
}
# Command 14: an unknown JSON route gets a JSON 404, not the app shell.
s14_json_not_found() {
  local answer
  answer=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "$APP_ORIGIN/api/share/not-a-real-slug")
  echo "$answer"
  [ "$answer" = "404 application/json; charset=utf-8" ]
}
# Command 15: a write without an Origin header is refused.
s15_origin_refused() {
  local answer
  answer=$(curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"displayName":"probe"}' "$APP_ORIGIN/api/people")
  echo "$answer"
  [ "$answer" = "403" ]
}
# Command 16: the whole golden path, steps 1 to 16, in replay mode, with its own checks in the report. The assertion names are the
# script's own (scripts/golden-path/steps-brief-to-deletion.ts).
s16_golden_path() {
  pnpm golden-path --mock --base "$APP_ORIGIN" --report "$EVIDENCE/golden-path.json"
  local report="$EVIDENCE/golden-path.json"
  jq -e '.result == "pass"' "$report" >/dev/null
  jq -e '.ledger.modes == ["replay"]' "$report" >/dev/null
  jq -e '[.steps[] | select(.name == "stream") | .assertions[] | select(.name == "planned reconnect") | .pass] == [true]' "$report" >/dev/null
  jq -e '[.steps[] | select(.name == "brief") | .assertions[] | select(.name == "exactly one line is unsupported" or .name == "the unsupported line is not in decide first") | .pass] == [true, true]' "$report" >/dev/null
  jq -e '[.steps[] | select(.name == "comic") | .assertions[] | select(.name == "the comic is written after the brief") | .pass] == [true]' "$report" >/dev/null
  jq -e '[.steps[] | select(.name == "delete") | .assertions[] | select(.name == "every table is empty for A") | .pass] == [true]' "$report" >/dev/null
}
# Command 17: the eval in replay mode against the api and worker of command 09: seven metrics with sample sizes, the two thresholds, the results
# file, then the eval's two stack tests against the same pair.
s17_eval() {
  pnpm eval --replay
  local metric
  for metric in "evidence validity" "grounded brief rate" "support rate" "injection leakage" "end-to-end completion" "first-turn latency" "cost per complete pair"; do
    grep -q "$metric" "$EVIDENCE/17-eval.txt"
  done
  jq -e '.commit and .date and .llmMode == "replay" and .model and (.metrics | length == 7) and (.thresholdFailures | length == 0)' "$ROOT/eval/results.json" >/dev/null
  # The eval's own stack tests (W2-EVAL-T13 and T14) run only when EVAL_BASE_URL names a running stack; here one is running.
  EVAL_BASE_URL="$APP_ORIGIN" pnpm exec vitest run --project integration packages/evals/src/run-eval.integration.test.ts
}
# Command 18: the api image builds the web app, then the api, on Node 22 (D72).
s18_docker_api() {
  docker build -f Dockerfile.api -t meet-first-api:check .
  # grep without -q reads the whole output, so docker never writes into a closed pipe, which pipefail would count as a failure.
  docker run --rm meet-first-api:check node --version | grep '^v22\.'
}
# Command 19: the worker image builds on Node 22 (D72).
s19_docker_worker() {
  docker build -f Dockerfile.worker -t meet-first-worker:check .
  # grep without -q reads the whole output, so docker never writes into a closed pipe, which pipefail would count as a failure.
  docker run --rm meet-first-worker:check node --version | grep '^v22\.'
}
# Command 20: the production image refuses to boot in replay mode (D74, R13.3), before it reads the schema, since the database URL is given.
s20_production_refuses_replay() {
  local output code
  set +e
  output=$(docker run --rm -e NODE_ENV=production -e LLM_MODE=replay -e DATABASE_URL_WORKER="$DATABASE_URL_WORKER" -e META_API_KEY=x -e META_API_BASE_URL=https://api.meta.ai/v1 meet-first-worker:check 2>&1)
  code=$?
  set -e
  echo "$output"
  echo "exit=$code"
  [ "$code" -ne 0 ]
  echo "$output" | grep -q 'llm_mode_replay_in_production'
  ! echo "$output" | grep -q 'DATABASE_URL_WORKER'
}
# Command 21: eslint, with its limits on lines, branches, nesting, inputs and comments.
s21_lint() { pnpm lint; }
# Command 22: the repo checks: banned names, plain words, no em dashes, README headings, Mermaid, architecture docs, migrations.
s22_checks() { pnpm checks; }
# Command 23: no mock module, no model key outside the worker, and MSW only under apps/web/src/testing, in code; a README may name them to say so.
s23_forbidden_imports() {
  local mock key msw
  # grep exits 1 when it finds nothing, which is the pass case here. The row runs in its own process, so this changes only this row.
  set +o pipefail
  mock=$(grep -rln --exclude-dir=node_modules --exclude-dir=dist --exclude="*.md" "mock-api" apps packages 2>/dev/null | wc -l | tr -d ' ')
  key=$(grep -rln --exclude-dir=node_modules --exclude-dir=dist --exclude="*.md" "META_API_KEY" apps/web apps/api 2>/dev/null | wc -l | tr -d ' ')
  # Both quote styles: the code base writes imports with double quotes, so a single-quote grep alone would always pass.
  msw=$(grep -rlnE --exclude-dir=node_modules --exclude-dir=dist --exclude="*.md" "from ['\"]msw['\"/]" apps packages 2>/dev/null | grep -v '^apps/web/src/testing/' | wc -l | tr -d ' ')
  echo "mock-api $mock META_API_KEY $key msw $msw"
  [ "$mock" = "0" ] && [ "$key" = "0" ] && [ "$msw" = "0" ]
}
# Command 24: no session token reached a log line.
s24_no_tokens_in_logs() {
  local api worker
  api=$(grep -Ec 'session=[A-Za-z0-9_-]{20,}' "$EVIDENCE/api.log" || true)
  worker=$(grep -Ec 'session=[A-Za-z0-9_-]{20,}' "$EVIDENCE/worker.log" || true)
  echo "api.log $api worker.log $worker"
  [ "$api" = "0" ] && [ "$worker" = "0" ]
}
# Command 25: both processes exit within 30 seconds of the stop signal.
s25_stop_servers() {
  kill "$(cat "$EVIDENCE/api.pid")" "$(cat "$EVIDENCE/worker.pid")" 2>/dev/null || true
  sleep 2
  for _ in $(seq 1 28); do
    if ! kill -0 "$(cat "$EVIDENCE/api.pid")" 2>/dev/null && ! kill -0 "$(cat "$EVIDENCE/worker.pid")" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

# Runs one command under its time cap (through perl's alarm, since macOS has no timeout command), keeps its output, and writes one summary line.
step() {
  local number="$1" name="$2" cap="$3" function_name="$4" started code took
  started=$(date +%s)
  set +e
  perl -e 'alarm shift @ARGV; exec @ARGV' "$cap" bash "$SELF" --run "$function_name" > "$EVIDENCE/$number-$name.txt" 2>&1
  code=$?
  set -e
  took=$(( $(date +%s) - started ))
  if [ "$code" -eq 0 ]; then
    printf '%s %s pass exit=%s %ss\n' "$number" "$name" "$code" "$took" >> "$SUMMARY"
    return 0
  fi
  printf '%s %s fail exit=%s %ss\n' "$number" "$name" "$code" "$took" >> "$SUMMARY"
  printf 'check-wave-2: fail at %s\n' "$number" >> "$SUMMARY"
  echo "check-wave-2: fail at $number $name; output in $EVIDENCE/$number-$name.txt" >&2
  exit 1
}

# Stops the two processes if they are still running, so a failed run leaves no server on the port.
stop_servers() {
  if [ -f "$EVIDENCE/api.pid" ] && [ -f "$EVIDENCE/worker.pid" ]; then
    kill "$(cat "$EVIDENCE/api.pid")" "$(cat "$EVIDENCE/worker.pid")" 2>/dev/null || true
  fi
}

main() {
  cd "$ROOT"
  preconditions
  mkdir -p "$EVIDENCE"
  : > "$SUMMARY"
  { git rev-parse HEAD; date -u +%FT%TZ; } > "$EVIDENCE/00-run.txt"
  trap stop_servers EXIT
  step 01 install 300 s01_install
  step 02 typecheck 300 s02_typecheck
  step 03 database 180 s03_database
  step 04 forced-rls 10 s04_forced_rls
  step 05 tables 10 s05_tables
  step 06 definer-functions 10 s06_definer_functions
  step 07 quiz-bank 10 s07_quiz_bank
  step 08 build 600 s08_build
  step 09 start 30 s09_start_servers
  step 10 health-database 60 s10_health_database
  step 11 health-worker 150 s11_health_worker
  step 12 root-page 10 s12_root_page
  step 13 spa-fallback 10 s13_spa_fallback
  step 14 json-not-found 10 s14_json_not_found
  step 15 origin-refused 10 s15_origin_refused
  step 16 golden-path 1500 s16_golden_path
  step 17 eval 1200 s17_eval
  if [ "$WITHOUT_DOCKER" = 1 ]; then
    printf '%s\n' "18 docker-api not-run --without-docker" "19 docker-worker not-run --without-docker" "20 production-refuses-replay not-run --without-docker" >> "$SUMMARY"
  else
    step 18 docker-api 900 s18_docker_api
    step 19 docker-worker 900 s19_docker_worker
    step 20 production-refuses-replay 60 s20_production_refuses_replay
  fi
  step 21 lint 300 s21_lint
  step 22 checks 300 s22_checks
  step 23 forbidden-imports 30 s23_forbidden_imports
  step 24 no-tokens-in-logs 10 s24_no_tokens_in_logs
  step 25 stop-servers 30 s25_stop_servers
  if [ "$WITHOUT_DOCKER" = 1 ]; then
    echo "check-wave-2: not complete; every row ran and passed except 18 to 20, which need Docker and did not run" >> "$SUMMARY"
  else
    echo "check-wave-2: pass" >> "$SUMMARY"
  fi
  cat "$SUMMARY"
  # Exit 0 only when every row ran and passed (check-wave-2.md section 1); a run without the Docker rows exits 3, so a caller that
  # reads only the exit code never takes it for a pass.
  if [ "$WITHOUT_DOCKER" = 1 ]; then exit 3; fi
}

if [ "${1:-}" = "--run" ]; then
  # Reached only from step(): runs one command in its own process so the time cap can end it.
  cd "$ROOT"
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.check"
  set +a
  "$2"
else
  [ "${1:-}" = "--without-docker" ] && WITHOUT_DOCKER=1
  main "$@"
fi
