#!/usr/bin/env bash
# A deploy happens only from a tag that sits on the release branch, through the deploy hooks.
# With RENDER_DEPLOY_HOOK set, the one service of render.yaml runs the api and the worker, and its start script migrates before
# either starts, so one hook does it all. With two services instead, the api's hook goes first, and the worker's deploy is
# requested only once the api's pre-deploy migrations have brought the database to the tag's schema version, because the worker
# refuses to boot on any other.
# Usage: scripts/release.sh v1.0.0 (or run it on a checked-out tag with no argument), with RENDER_DEPLOY_HOOK set, or with
# RENDER_DEPLOY_HOOK_API, RENDER_DEPLOY_HOOK_WORKER and APP_ORIGIN. RELEASE_WAIT_SECONDS (15) and RELEASE_WAIT_TRIES (160) set
# the two-service wait, 40 minutes.
set -euo pipefail

TAG="${1:-$(git describe --tags --exact-match 2>/dev/null || true)}"
if [ -z "$TAG" ]; then
  echo "release_tag_missing: pass the tag, for example scripts/release.sh v1.0.0, or check out a tagged commit." >&2
  exit 2
fi
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "release_tag_unknown: tag $TAG does not exist. Create it with git tag $TAG on the release branch first." >&2
  exit 2
fi
git fetch -q origin release
if ! git merge-base --is-ancestor "$TAG" origin/release; then
  echo "release_tag_not_on_release: $TAG is not on the release branch. Merge main into release, tag there, push the tag." >&2
  exit 2
fi

# A Render deploy hook builds the commit whose SHA it gets as ref, and a tag name is not a SHA (render.com/docs/deploy-hooks).
COMMIT="$(git rev-parse "$TAG^{commit}")"
if [ -n "${RENDER_DEPLOY_HOOK:-}" ]; then
  echo "Deploying $TAG ($COMMIT) to the one service."
  curl -fsS -X POST "${RENDER_DEPLOY_HOOK}&ref=${COMMIT}" >/dev/null
  echo "Deploy requested for $TAG. Watch the Render dashboard; then curl \$APP_ORIGIN/api/health and expect db true and worker true (done gate 1)."
  exit 0
fi
if [ -z "${RENDER_DEPLOY_HOOK_API:-}" ] || [ -z "${RENDER_DEPLOY_HOOK_WORKER:-}" ]; then
  echo "release_hooks_missing: set RENDER_DEPLOY_HOOK for the one service of render.yaml, or RENDER_DEPLOY_HOOK_API and RENDER_DEPLOY_HOOK_WORKER for two services, from the Render dashboard." >&2
  exit 2
fi
if [ -z "${APP_ORIGIN:-}" ]; then
  echo "release_origin_missing: set APP_ORIGIN to the api's address, such as https://meet-first-api.onrender.com, so the script can wait for the migrations." >&2
  exit 2
fi

# The schema version the worker of this tag expects: the highest migration number in the tag's tree, read as check-wave-3.sh reads it.
EXPECTED="$(git ls-tree --name-only --full-tree "$COMMIT" packages/db/migrations/ | sed -nE 's#^packages/db/migrations/([0-9]{4})_.*\.sql$#\1#p' | sort | tail -1 | sed 's/^0*//')"
if [ -z "$EXPECTED" ]; then
  echo "release_schema_unknown: $TAG has no migration files in packages/db/migrations, so the script cannot tell when the worker may start." >&2
  exit 2
fi
WAIT_SECONDS="${RELEASE_WAIT_SECONDS:-15}"
WAIT_TRIES="${RELEASE_WAIT_TRIES:-160}"

echo "Deploying $TAG ($COMMIT): api first, then the worker once the database is at schema version $EXPECTED."
curl -fsS -X POST "${RENDER_DEPLOY_HOOK_API}&ref=${COMMIT}" >/dev/null
# The health route always answers 200 and reports the schema version it reads from the database. A read with no answer
# (the api is not up yet) counts as a try like any other.
seen=""
tries=0
while [ "$seen" != "$EXPECTED" ]; do
  if [ "$tries" -ge "$WAIT_TRIES" ]; then
    echo "release_schema_wait_timeout: after $tries health reads the database reports schema version ${seen:-none} and $TAG expects $EXPECTED, so the worker was not deployed. Read the api's deploy log in the Render dashboard." >&2
    exit 3
  fi
  if [ "$tries" -gt 0 ]; then sleep "$WAIT_SECONDS"; fi
  seen="$(curl -sS "$APP_ORIGIN/api/health" 2>/dev/null | sed -nE 's/.*"schemaVersion": *([0-9]+).*/\1/p' || true)"
  tries=$((tries + 1))
done
echo "The database is at schema version $EXPECTED; deploying the worker."
curl -fsS -X POST "${RENDER_DEPLOY_HOOK_WORKER}&ref=${COMMIT}" >/dev/null
echo "Deploy requested for $TAG. Watch the Render dashboard; then curl \$APP_ORIGIN/api/health and expect db true and worker true (done gate 1)."
