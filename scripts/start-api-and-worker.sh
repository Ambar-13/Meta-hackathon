#!/usr/bin/env bash
# Starts the api and the worker in one container, for the one Render service (render.yaml).
# It applies the migrations first, the job of Render's pre-deploy command, which a free service lacks, then starts both.
# Each process gets only its own variables: the api never sees META_API_KEY, so the key stays in the worker as it did on two
# services, and neither keeps the app_migrate URL. In the container this script runs as root
# (Dockerfile.render) and starts each process as its own user, so neither can read the other's environment or this script's
# through /proc. When one process stops, the other is stopped too and the container exits, so Render restarts it. SIGTERM
# reaches both, and each drains its work before it exits.
set -euo pipefail
cd "$(dirname "$0")/.."

is_root=0
if [ "$(id -u)" = 0 ]; then is_root=1; fi
if [ "$is_root" = 1 ] && ! command -v setpriv >/dev/null; then
  echo "start_setpriv_missing: this script runs as root but cannot drop to the api and worker users; build from Dockerfile.render." >&2
  exit 1
fi

# Runs a command as the given user when this script is root (the container), with that user's own home and temporary folder
# (Dockerfile.render) and no NODE_PATH, so Node finds no module and tsx no compiled file the other user could have written.
# Run as any other user, as on a laptop, the command runs as it is.
as_user() {
  local user="$1"
  shift
  if [ "$is_root" = 1 ]; then
    exec setpriv --reuid="$user" --regid="$user" --clear-groups --no-new-privs -- env HOME="/home/$user" TMPDIR="/home/$user/tmp" NODE_PATH= "$@"
  fi
  exec "$@"
}

pnpm -w db:migrate

# The sample people of Explore (packages/db/src/samples/seed-samples.ts), unless SEED_SAMPLES is 0. Like the migrations it runs
# before the api and the worker start, so tsx runs as root only while no other process could have written to the shared /tmp. Once
# all six are listed it adds nothing. It gets only the api and worker URLs. A failure is logged and stops nothing, because Explore
# works without them.
if [ "${SEED_SAMPLES:-1}" != "0" ]; then
  (cd packages/db && env -u META_API_KEY -u DATABASE_URL_MIGRATE -u ACCESS_CODE node --import tsx src/samples/seed-samples.ts) || echo "seed_samples_failed: the app runs without the sample people." >&2
fi

(cd apps/api && as_user meet-api env -u META_API_KEY -u DATABASE_URL_MIGRATE -u DATABASE_URL_WORKER node --import tsx src/server.ts) &
api=$!
(cd apps/worker && as_user meet-worker env -u DATABASE_URL_MIGRATE -u DATABASE_URL_API -u ACCESS_CODE node --import tsx src/runner.ts) &
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
