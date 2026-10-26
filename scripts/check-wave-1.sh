#!/usr/bin/env bash
# The integration check that gates Wave 2: a fresh local database, the api and the worker in replay mode, then the golden path.
# It never edits a source file, pushes or merges. Every command writes its output under docs/evidence/check-wave-1/ and a summary line.
set -euo pipefail

SELF="$0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SELF="$ROOT/scripts/check-wave-1.sh"
EVIDENCE="$ROOT/docs/evidence/check-wave-1"
SUMMARY="$EVIDENCE/summary.txt"

# Refuses to run unless the tree is merged, clean and set up. Each refusal names its reason and exits 2.
preconditions() {
  for tool in jq psql curl lsof; do
    if ! command -v "$tool" >/dev/null; then
      echo "check_wave_tool_missing: $tool is not installed" >&2
      exit 2
    fi
  done
  # The evidence folder is this check's own output, so a rerun does not count it as an uncommitted change.
  if [ -n "$(git -C "$ROOT" status --porcelain -- . ':!docs/evidence')" ]; then
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
  if [ ! -f "$ROOT/.env.check" ]; then
    echo "check_wave_env_missing: copy .env.example to .env.check and fill the three database URLs" >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.check"
  set +a
  if [ "${LLM_MODE:-}" != "replay" ]; then
    echo "check_wave_1_needs_replay: this check runs on fixtures only; D74" >&2
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
# Command 05: the schema holds 30 tables in public: 25 from 0001 (asks dropped, as-built item 28), 2 from 0002 (item 29) and 3 from 0006 (item 49).
s05_tables() {
  local count
  count=$(psql "$DATABASE_URL_MIGRATE" -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'")
  echo "$count"
  [ "$count" = "30" ]
}
# Command 06: the security definer functions are exactly the 20 of 0001, 0003 and 0006 (as-built items 6, 34 and 49).
s06_definer_functions() {
  local count
  count=$(psql "$DATABASE_URL_MIGRATE" -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef")
  echo "$count"
  [ "$count" = "20" ]
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
# Command 16: the golden path, steps 1 to 12, in replay mode, with its own checks in the report.
s16_golden_path() {
  pnpm golden-path --mock --until brief --base "$APP_ORIGIN" --report "$EVIDENCE/golden-path.json"
  jq -e '.result == "pass"' "$EVIDENCE/golden-path.json" >/dev/null
  jq -e '.ledger.modes == ["replay"]' "$EVIDENCE/golden-path.json" >/dev/null
  jq -e '[.steps[] | select(.name == "stream") | .assertions[] | select(.name == "planned reconnect") | .pass] == [true]' "$EVIDENCE/golden-path.json" >/dev/null
}
# Command 17: no session token reached a log line.
s17_no_tokens_in_logs() {
  local api worker
  api=$(grep -Ec 'session=[A-Za-z0-9_-]{20,}' "$EVIDENCE/api.log" || true)
  worker=$(grep -Ec 'session=[A-Za-z0-9_-]{20,}' "$EVIDENCE/worker.log" || true)
  echo "api.log $api worker.log $worker"
  [ "$api" = "0" ] && [ "$worker" = "0" ]
}
# Command 18: error-level log lines are counted and recorded, and never fail the check on their own.
s18_error_log_counts() {
  local api worker
  api=$(grep -c '"level":50' "$EVIDENCE/api.log" || true)
  worker=$(grep -c '"level":50' "$EVIDENCE/worker.log" || true)
  echo "api $api worker $worker"
}
# Command 19: both processes exit within 30 seconds of the stop signal.
s19_stop_servers() {
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
  printf 'check-wave-1: fail at %s\n' "$number" >> "$SUMMARY"
  echo "check-wave-1: fail at $number $name; output in $EVIDENCE/$number-$name.txt" >&2
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
  step 16 golden-path 1200 s16_golden_path
  step 17 no-tokens-in-logs 10 s17_no_tokens_in_logs
  step 18 error-log-counts 10 s18_error_log_counts
  echo "18 error-log-counts info $(tr '\n' ' ' < "$EVIDENCE/18-error-log-counts.txt")" >> "$SUMMARY"
  step 19 stop-servers 30 s19_stop_servers
  echo "check-wave-1: pass" >> "$SUMMARY"
  cat "$SUMMARY"
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
  main "$@"
fi
