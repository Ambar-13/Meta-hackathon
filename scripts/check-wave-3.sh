#!/usr/bin/env bash
# The integration check that gates the phone gate: the golden path with --live against the Render deployment, the proof that the
# worker booted live, that the ledger has every call site, that every model reply fixture is a recording, that no mock survives,
# and that production refuses replay (specs/checks/check-wave-3.md). It never edits a source file, pushes, merges or migrates.
# Every command writes its output under docs/evidence/check-wave-3/ and a summary line.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SELF="$ROOT/scripts/check-wave-3.sh"
EVIDENCE="$ROOT/docs/evidence/check-wave-3"
SUMMARY="$EVIDENCE/summary.txt"
# The env file names only the deployment and its database: APP_ORIGIN and DATABASE_URL_WORKER (the Render database's external URL
# for app_worker). It is git-ignored like every .env file, and it never sets LLM_MODE, because the deployed mode is what is checked.
ENV_FILE="$ROOT/.env.wave3"
# The call sites the golden path uses; comic_image is added when the comic came out ready (row 06).
FLOW_CALL_SITES='["scrub_names","question_check","card","quiz_answer","quiz_judge","speech","receipts","brief","brief_support_judge","comic_panels","persona_answer","ask_support_judge"]'
# Every call site that must keep at least one recording after Wave 3 (row 09).
RECORDED_CALL_SITES="scrub_names question_check card quiz_answer quiz_judge speech receipts brief brief_support_judge comic_panels comic_image persona_answer ask_support_judge self_test"

# Loads the env file and refuses an LLM_MODE in the shell or in the file (check-wave-3.md section 7).
load_env() {
  if [ -n "${LLM_MODE:-}" ]; then
    echo "check_wave_3_mode_in_shell: unset LLM_MODE; the deployed worker's mode is the fact this check reads" >&2
    exit 2
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "check_wave_3_env_missing: write .env.wave3 with APP_ORIGIN and DATABASE_URL_WORKER (the Render external URL for app_worker); pnpm db:render-roles writes it" >&2
    exit 2
  fi
  if grep -q '^LLM_MODE=' "$ENV_FILE"; then
    echo "check_wave_3_mode_in_env_file: remove LLM_MODE from .env.wave3" >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

# Refuses to run unless the deployment, its database and the rate budget allow a run. Each refusal names its reason.
preconditions() {
  local tool
  for tool in jq psql curl; do
    if ! command -v "$tool" >/dev/null; then
      echo "check_wave_tool_missing: $tool is not installed" >&2
      exit 2
    fi
  done
  case "${APP_ORIGIN:-}" in
    https://*) ;;
    *) echo "check_wave_3_origin: set APP_ORIGIN=https://... in .env.wave3; the __Host- cookie needs Secure" >&2; exit 2 ;;
  esac
  if [ "$(psql "$DATABASE_URL_WORKER" -Atc 'SELECT 1' 2>/dev/null || true)" != "1" ]; then
    echo "check_wave_3_database_unreachable: DATABASE_URL_WORKER does not answer SELECT 1" >&2
    exit 2
  fi
  local deployed expected
  deployed=$(curl -fsS "$APP_ORIGIN/api/health" | jq -r '.schemaVersion' 2>/dev/null || echo "none")
  expected=$(find "$ROOT/packages/db/migrations" -name '[0-9][0-9][0-9][0-9]_*.sql' | sed -E 's#.*/([0-9]{4})_.*#\1#' | sort | tail -1 | sed 's/^0*//')
  { git -C "$ROOT" rev-parse HEAD; date -u +%FT%TZ; echo "deployed schemaVersion $deployed, migrations up to $expected"; } > "$EVIDENCE/00-run.txt"
  if [ "$deployed" != "$expected" ]; then
    echo "check_wave_3_schema_mismatch: the deployment reports schema version $deployed and the tree has $expected; deploy from release first" >&2
    exit 2
  fi
  # Each run makes 2 accounts, and the api allows 10 per IP per hour (R9.5), so at most 3 runs in any 60 minutes.
  local recent=0 now line
  now=$(date -u +%s)
  if [ -f "$EVIDENCE/runs-this-hour.txt" ]; then
    while IFS= read -r line; do
      if [ -n "$line" ] && [ $((now - line)) -lt 3600 ]; then recent=$((recent + 1)); fi
    done < "$EVIDENCE/runs-this-hour.txt"
  fi
  if [ "$recent" -ge 3 ]; then
    echo "check_wave_3_rate_budget: 3 runs in the last hour; each run makes 2 accounts against the 10 per IP per hour limit (R9.5); wait" >&2
    exit 3
  fi
}

# Command 01: the deployed api answers and reaches its database.
s01_health() {
  curl -fsS "$APP_ORIGIN/api/health" | tee "$EVIDENCE/01-health.json"
  echo
  jq -e '.ok == true and .db == true' "$EVIDENCE/01-health.json" >/dev/null
}
# Command 02: the deployed worker booted: schema version asserted, the live self-test passed, and its heartbeat is fresh (R3.1, R3.9).
s02_worker() { jq -e '.worker == true' "$EVIDENCE/01-health.json"; }
# Command 03: Postgres disk under 80% (R12.5). Informational: the plan size is unverified.
s03_disk() { jq -r 'if .degraded then "warning: degraded (disk at \(.diskPct)%)" else "disk ok" end' "$EVIDENCE/01-health.json"; }
# Command 04: real-wire's local live self-test log has one ok line per model output schema (specs/wave-3-real-wire.md 4.2).
s04_self_test_log() {
  local log="$ROOT/docs/evidence/wave-3/self-test-live.txt" ok schemas
  test -s "$log"
  ok=$(grep -c 'self-test [^:]*: ok' "$log" || true)
  schemas=$(find "$ROOT/packages/prompts" -name schema.json | wc -l | tr -d ' ')
  echo "ok lines $ok, schemas $schemas"
  [ "$ok" = "$schemas" ]
}
# Command 05: all 22 golden-path steps against the deployment with the real model; every ledger row the run wrote is live (D74).
s05_golden_path() {
  pnpm golden-path --live --base "$APP_ORIGIN" --report "$EVIDENCE/golden-path.json"
  jq -e '.result == "pass"' "$EVIDENCE/golden-path.json" >/dev/null
  jq -e '.ledger.modes == ["live"]' "$EVIDENCE/golden-path.json" >/dev/null
  jq -r '[.steps[] | select(.result == "not-exercised") | "not-exercised: step \(.number) \(.name): \(.detail)"] | .[]' "$EVIDENCE/golden-path.json"
}
# Command 06: the ledger has a row for every call site the flow used, comic_image too when the comic came out ready (R3.5, R10.8).
s06_call_sites() {
  local report="$EVIDENCE/golden-path.json"
  jq -e --argjson sites "$FLOW_CALL_SITES" '.ledger.callSites | contains($sites)' "$report" >/dev/null
  if jq -e '[.steps[] | select(.name == "comic")][0].detail | test("ready")' "$report" >/dev/null; then
    jq -e '.ledger.callSites | contains(["comic_image"])' "$report" >/dev/null
  fi
  jq -c '.ledger.callSites' "$report"
}
# Command 07: no hand-written model reply survives Wave 3 (R13.3).
s07_no_hand_written() {
  local count
  count=$(grep -rl '"handWritten": true' "$ROOT/packages/evals/fixtures/model-replies" | wc -l | tr -d ' ' || true)
  echo "hand-written $count"
  [ "$count" = "0" ]
}
# Command 08: every fixture is a RecordedCall with recordedAt set.
s08_recordings() {
  local file bad=0
  while IFS= read -r file; do
    if ! jq -e '.callSite and .promptVersion and .requestHash and .request and .response and .usage and .recordedAt' "$file" >/dev/null; then
      echo "not a recording: ${file#"$ROOT"/}"
      bad=$((bad + 1))
    fi
  done < <(find "$ROOT/packages/evals/fixtures/model-replies" -name '*.json' | sort)
  [ "$bad" -eq 0 ]
}
# Command 09: each of the 12 call sites keeps at least one recording, so replay keeps working after Wave 3.
s09_every_call_site_recorded() {
  set +o pipefail
  local site count missing=0
  for site in $RECORDED_CALL_SITES; do
    count=$(find "$ROOT/packages/evals/fixtures/model-replies/$site" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
    echo "$site $count"
    if [ "$count" -lt 1 ]; then echo "missing: $site"; missing=$((missing + 1)); fi
  done
  [ "$missing" -eq 0 ]
}
# The greps of rows 10 to 13 count files; grep exits 1 when it finds nothing, which is their pass case, so these rows run without
# pipefail. The check scripts hold the searched words themselves, and a README may name them to say a package never uses them.
code_hits() { grep -rlE --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=dist-gallery --exclude='*.md' --exclude='check-wave-*.sh' "$@" 2>/dev/null | wc -l | tr -d ' '; }
# Command 10: no mock module survives (D74, R13.3).
s10_no_mock_module() {
  set +o pipefail
  local hits
  hits=$(code_hits "mock-api" "$ROOT/apps" "$ROOT/packages" "$ROOT/scripts")
  echo "mock-api $hits"
  [ "$hits" = "0" ]
}
# Command 11: LLM_MODE is read only in packages/llm, the env schema, and the worker's boot that hands it over (D74).
s11_mode_confined() {
  set +o pipefail
  local hits
  hits=$(grep -rlE --include='*.ts' --include='*.tsx' 'env\.LLM_MODE|env\[.LLM_MODE.\]' "$ROOT/apps" "$ROOT/packages" 2>/dev/null | sed "s#^$ROOT/##" | grep -v '^packages/llm/' | grep -v '^packages/contracts/src/operations/env' | grep -v '^apps/worker/src/runner.ts' | grep -v node_modules | wc -l | tr -d ' ')
  echo "LLM_MODE readers outside the allowed places $hits"
  [ "$hits" = "0" ]
}
# Command 12: the key and the model client never reach the web or the api; MSW only under apps/web/src/testing; no MODEL_MOCK.
s12_key_and_client_confined() {
  set +o pipefail
  local key client msw model_mock
  key=$(code_hits "META_API_KEY" "$ROOT/apps/web" "$ROOT/apps/api")
  client=$(code_hits "@meet-first/llm" "$ROOT/apps/web/src" "$ROOT/apps/api/src")
  msw=$(grep -rlE --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=dist-gallery --exclude='*.md' "from ['\"]msw['\"/]" "$ROOT/apps" "$ROOT/packages" 2>/dev/null | sed "s#^$ROOT/##" | grep -v '^apps/web/src/testing/' | wc -l | tr -d ' ')
  model_mock=$(code_hits "MODEL_MOCK" "$ROOT/apps" "$ROOT/packages" "$ROOT/scripts")
  echo "META_API_KEY $key, @meet-first/llm $client, msw $msw, MODEL_MOCK $model_mock"
  [ "$key" = "0" ] && [ "$client" = "0" ] && [ "$msw" = "0" ] && [ "$model_mock" = "0" ]
}
# Command 13: no fake model client outside tests and testing folders (D74).
s13_no_fake_client() {
  set +o pipefail
  local hits
  hits=$(grep -rlniE --include='*.ts' 'fake(Llm|Model|Gateway|Client)|stub(Llm|Model)' "$ROOT/apps" "$ROOT/packages" 2>/dev/null | grep -v node_modules | grep -v '\.test\.ts' | grep -v '/src/testing/' | wc -l | tr -d ' ')
  echo "fake clients $hits"
  [ "$hits" = "0" ]
}
# Command 14: the refusal of replay in production exists in code at one of the allowed places (D74).
s14_refusal_in_code() {
  grep -n "replay" "$ROOT/apps/worker/src/runner.ts" "$ROOT/packages/llm/src/modes.ts" "$ROOT/packages/llm/src/config.ts" | grep -i "production"
}
# Command 15: a production worker in replay exits at boot with the refusal code, given a real database URL (D74, R13.3, R10.2).
s15_replay_refused() {
  local output code
  set +e
  output=$(NODE_ENV=production LLM_MODE=replay DATABASE_URL_WORKER="$DATABASE_URL_WORKER" META_API_KEY=x META_API_BASE_URL=https://api.meta.ai/v1 perl -e 'alarm shift @ARGV; exec @ARGV' 30 pnpm --filter @meet-first/worker start 2>&1)
  code=$?
  set -e
  echo "$output"
  echo "exit=$code"
  # 142 is the alarm, which would mean the worker kept running in replay.
  [ "$code" -ne 0 ] && [ "$code" -ne 142 ]
  echo "$output" | grep -q 'llm_mode_replay_in_production'
}
# Command 16: the worker's heartbeat row, read directly; it is written each minute by the sweep_stalled cron.
s16_heartbeat() {
  local fresh
  fresh=$(psql "$DATABASE_URL_WORKER" -Atc "SELECT seen_at > now() - interval '2 minutes' FROM service_heartbeats WHERE service = 'worker'")
  echo "$fresh"
  [ "$fresh" = "t" ]
}
# Command 17: The stream check from a phone hotspot through the Render proxy. Informational: polling is primary on a buffering proxy (R8.2).
s17_phone_stream() {
  local log="$ROOT/docs/evidence/wave-3/sse-phone.txt" beats
  if [ ! -s "$log" ]; then echo "warning: no phone stream evidence at docs/evidence/wave-3/sse-phone.txt"; return 0; fi
  beats=$(grep -c '^:hb' "$log" || true)
  if [ "$beats" -ge 1 ]; then echo "heartbeats $beats"; else echo "warning: proxy buffers; polling is primary on this proxy (R8.2)"; fi
}
# Command 18: the golden path's own proxy timing. Informational.
s18_proxy_timing() { grep -E 'first byte [0-9a-z]+ ms' "$EVIDENCE/05-golden-path.txt" || echo "no proxy timing line"; }

# Runs one command under its time cap (through perl's alarm, since macOS has no timeout command), keeps its output, and writes one
# summary line. An informational row never stops the run.
step() {
  local number="$1" name="$2" cap="$3" function_name="$4" kind="${5:-required}" started code took
  started=$(date +%s)
  set +e
  perl -e 'alarm shift @ARGV; exec @ARGV' "$cap" bash "$SELF" --run "$function_name" > "$EVIDENCE/$number-$name.txt" 2>&1
  code=$?
  set -e
  took=$(( $(date +%s) - started ))
  if [ "$kind" = "info" ]; then
    printf '%s %s info %s\n' "$number" "$name" "$(tr '\n' ' ' < "$EVIDENCE/$number-$name.txt" | cut -c1-160)" >> "$SUMMARY"
    return 0
  fi
  if [ "$code" -eq 0 ]; then
    printf '%s %s pass exit=%s %ss\n' "$number" "$name" "$code" "$took" >> "$SUMMARY"
    return 0
  fi
  printf '%s %s fail exit=%s %ss\n' "$number" "$name" "$code" "$took" >> "$SUMMARY"
  printf 'check-wave-3: fail at %s\n' "$number" >> "$SUMMARY"
  echo "check-wave-3: fail at $number $name; output in $EVIDENCE/$number-$name.txt" >&2
  exit 1
}

main() {
  cd "$ROOT"
  load_env
  mkdir -p "$EVIDENCE"
  preconditions
  : > "$SUMMARY"
  date -u +%s >> "$EVIDENCE/runs-this-hour.txt"
  step 01 health 30 s01_health
  step 02 worker 10 s02_worker
  step 03 disk 10 s03_disk info
  step 04 self-test-log 10 s04_self_test_log
  step 05 golden-path 1800 s05_golden_path
  step 06 call-sites 10 s06_call_sites
  step 07 no-hand-written 10 s07_no_hand_written
  step 08 recordings 60 s08_recordings
  step 09 every-call-site-recorded 10 s09_every_call_site_recorded
  step 10 no-mock-module 10 s10_no_mock_module
  step 11 mode-confined 10 s11_mode_confined
  step 12 key-and-client-confined 10 s12_key_and_client_confined
  step 13 no-fake-client 10 s13_no_fake_client
  step 14 refusal-in-code 10 s14_refusal_in_code
  step 15 replay-refused 60 s15_replay_refused
  step 16 heartbeat 10 s16_heartbeat
  step 17 phone-stream 10 s17_phone_stream info
  step 18 proxy-timing 10 s18_proxy_timing info
  echo "check-wave-3: pass" >> "$SUMMARY"
  cat "$SUMMARY"
}

if [ "${1:-}" = "--run" ]; then
  # Reached only from step(): runs one command in its own process so the time cap can end it.
  cd "$ROOT"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  "$2"
else
  main "$@"
fi
