#!/usr/bin/env bash
# D70, R12.3: a deploy happens only from a tag that sits on the release branch, through the two deploy hooks, api first then worker.
# Usage: scripts/release.sh v1.0.0   (or run it on a checked-out tag with no argument)
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
if [ -z "${RENDER_DEPLOY_HOOK_API:-}" ] || [ -z "${RENDER_DEPLOY_HOOK_WORKER:-}" ]; then
  echo "release_hooks_missing: set RENDER_DEPLOY_HOOK_API and RENDER_DEPLOY_HOOK_WORKER in your shell from the Render dashboard." >&2
  exit 2
fi

echo "Deploying $TAG: api first, then worker."
# The ref parameter tells the hook which commit to build (D70).
curl -fsS -X POST "${RENDER_DEPLOY_HOOK_API}&ref=${TAG}" >/dev/null
curl -fsS -X POST "${RENDER_DEPLOY_HOOK_WORKER}&ref=${TAG}" >/dev/null
echo "Deploy requested for $TAG. Watch the Render dashboard; then curl \$APP_ORIGIN/api/health and expect db true and worker true (done gate 1)."
