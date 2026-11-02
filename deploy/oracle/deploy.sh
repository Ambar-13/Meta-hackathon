#!/usr/bin/env bash
# Deploys a tag on the release branch to the Oracle server from this machine (deploy/oracle/README.md, D70). It sets the server
# up (safe to repeat), writes the server's secrets file on the first run, copies the tag's files over SSH, builds the images on
# the server, starts Postgres, the api, the worker and Caddy, and waits until /api/health reports the database, the worker and
# the tag's schema version. Then it writes .env.wave3 for scripts/check-wave-3.sh. It prints no password and no key.
# Usage: deploy/oracle/deploy.sh <tag>, with ORACLE_HOST, the server's public IP, in .env.oracle at the repository root
# (git-ignored). Optional: ORACLE_SSH_KEY (~/.ssh/meet_first_oracle), DEPLOY_WAIT_SECONDS (10), DEPLOY_WAIT_TRIES (120).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if [ -f .env.oracle ]; then set -a; . ./.env.oracle; set +a; fi

TAG="${1:-}"
if [ -z "$TAG" ] || ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "deploy_tag_missing: pass a tag that exists, for example deploy/oracle/deploy.sh wave-3-deploy-2." >&2
  exit 2
fi
git fetch -q origin release
if ! git merge-base --is-ancestor "$TAG" origin/release; then
  echo "deploy_tag_not_on_release: $TAG is not on the release branch. Merge main into release, tag there, push the tag." >&2
  exit 2
fi
if [ -z "${ORACLE_HOST:-}" ]; then
  echo "deploy_host_missing: put ORACLE_HOST=<the server's public IP> in .env.oracle at the repository root." >&2
  exit 2
fi

KEY="${ORACLE_SSH_KEY:-$HOME/.ssh/meet_first_oracle}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30 "ubuntu@$ORACLE_HOST")
APP=/opt/meet-first
COMMIT="$(git rev-parse "$TAG^{commit}")"
# sslip.io answers a name made of an IP address with that address, so Caddy can get a certificate with no DNS setup.
SITE="$(printf '%s' "$ORACLE_HOST" | tr . -).sslip.io"
ORIGIN="https://$SITE"
# The schema version the worker of this tag expects, read as release.sh and check-wave-3.sh read it.
EXPECTED="$(git ls-tree --name-only --full-tree "$COMMIT" packages/db/migrations/ | sed -nE 's#^packages/db/migrations/([0-9]{4})_.*\.sql$#\1#p' | sort | tail -1 | sed 's/^0*//')"
WAIT_SECONDS="${DEPLOY_WAIT_SECONDS:-10}"
WAIT_TRIES="${DEPLOY_WAIT_TRIES:-120}"

echo "Setting up the server."
"${SSH[@]}" 'bash -s' < deploy/oracle/set-up-server.sh

# The secrets file is made once, on the server: four random passwords, the site's name, and the Meta key from this machine's
# .env, which travels on SSH's input, so it is never printed or put on a command line.
if ! "${SSH[@]}" "test -f $APP/.env"; then
  if [ "$(grep -c '^META_API_KEY=' .env 2>/dev/null || true)" != "1" ]; then
    echo "deploy_meta_key_missing: .env at the repository root needs exactly one META_API_KEY line for the worker." >&2
    exit 2
  fi
  grep '^META_API_KEY=' .env | "${SSH[@]}" "umask 077 && { for name in POSTGRES_PASSWORD APP_MIGRATE_PASSWORD APP_API_PASSWORD APP_WORKER_PASSWORD; do echo \"\$name=\$(openssl rand -hex 24)\"; done; echo SITE_ADDRESS=$SITE; echo APP_ORIGIN=$ORIGIN; cat; } > $APP/.env"
  echo "Wrote the server's secrets file."
fi

echo "Copying $TAG ($COMMIT) to the server, then building and starting it."
git archive --format=tar "$COMMIT" | "${SSH[@]}" "mkdir -p $APP/releases/$COMMIT && tar -x -C $APP/releases/$COMMIT && ln -sfn $APP/releases/$COMMIT $APP/current"
"${SSH[@]}" "cd $APP/current/deploy/oracle && sudo docker compose --env-file $APP/.env up -d --build --remove-orphans"

# The worker's heartbeat comes once a minute and the first certificate can take a minute or two, so the wait allows 20 minutes.
echo "Waiting for $ORIGIN/api/health to show the database, the worker and schema version $EXPECTED."
tries=0
health=""
until printf '%s' "$health" | grep -q '"db":true' && printf '%s' "$health" | grep -q '"worker":true' && printf '%s' "$health" | grep -qE "\"schemaVersion\":$EXPECTED[,}]"; do
  if [ "$tries" -ge "$WAIT_TRIES" ]; then
    echo "deploy_health_timeout: after $tries reads, /api/health answered: ${health:-nothing}. The containers:" >&2
    "${SSH[@]}" "cd $APP/current/deploy/oracle && sudo docker compose --env-file $APP/.env ps" >&2 || true
    exit 3
  fi
  if [ "$tries" -gt 0 ]; then sleep "$WAIT_SECONDS"; fi
  health="$(curl -sS --max-time 10 "$ORIGIN/api/health" 2>/dev/null || true)"
  tries=$((tries + 1))
done
echo "Live: $health"

# For scripts/check-wave-3.sh: the site, and app_worker's URL through an SSH tunnel to the server's own Postgres port.
WORKER_PASSWORD="$("${SSH[@]}" "grep '^APP_WORKER_PASSWORD=' $APP/.env | cut -d= -f2-")"
(umask 077 && printf 'APP_ORIGIN=%s\nDATABASE_URL_WORKER=postgresql://app_worker:%s@127.0.0.1:55432/meet_first\n' "$ORIGIN" "$WORKER_PASSWORD" > .env.wave3)
echo "Wrote .env.wave3. Before scripts/check-wave-3.sh, open the tunnel: ssh -i $KEY -f -N -L 55432:127.0.0.1:5432 ubuntu@$ORACLE_HOST"

# Keeps the three newest releases and drops images no container uses.
"${SSH[@]}" "ls -1dt $APP/releases/* | tail -n +4 | xargs -r rm -rf && sudo docker image prune -f >/dev/null"
echo "Deployed $TAG to $ORIGIN."
