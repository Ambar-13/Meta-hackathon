#!/usr/bin/env bash
# Starts the api and the worker in one container, for the one Render service (render.yaml, D70 as amended on 2 Nov 2026).
# It applies the migrations first, the job of Render's pre-deploy command, which a free service lacks (D71), then starts both.
# Each process gets only its own variables: the api never sees META_API_KEY, so the key stays in the worker as it did on two
# services (ARCHITECTURE.md 8), and neither keeps the app_migrate URL. When one process stops, the other is stopped too and the
# container exits, so Render restarts it. SIGTERM reaches both, and each drains its work before it exits (D39).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm -w db:migrate

(cd apps/api && exec env -u META_API_KEY -u DATABASE_URL_MIGRATE -u DATABASE_URL_WORKER node --import tsx src/server.ts) &
api=$!
(cd apps/worker && exec env -u DATABASE_URL_MIGRATE -u DATABASE_URL_API node --import tsx src/runner.ts) &
worker=$!

signalled=0
stop_both() { kill -TERM "$api" "$worker" 2>/dev/null || true; }
on_signal() {
  signalled=1
  stop_both
}
trap on_signal TERM INT

# Checked once a second rather than with wait -n, so the script runs on any bash, the one on a Mac included.
set +e
while kill -0 "$api" 2>/dev/null && kill -0 "$worker" 2>/dev/null; do sleep 1; done
stop_both
wait "$api"
api_status=$?
wait "$worker"
worker_status=$?
if [ "$signalled" = 1 ]; then exit 0; fi
if [ "$api_status" -ne 0 ]; then exit "$api_status"; fi
if [ "$worker_status" -ne 0 ]; then exit "$worker_status"; fi
# Both stopped on their own with status 0: the service is still down, so the platform must restart it.
exit 1
