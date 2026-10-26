# Request build/w2-deploy-and-docs-001: root package.json

Request build/w2-deploy-and-docs-001. File: package.json.

Change wanted:

```diff
   "scripts": {
+    "release": "bash scripts/release.sh",
+    "path-ownership": "tsx scripts/path-ownership.ts",
+    "constants-name-rows": "tsx scripts/constants-name-rows.ts",
     "typecheck": "pnpm -r --parallel typecheck",
```

Why: the spec's day-one request 1; the CI jobs call the scripts with `pnpm tsx` and do not need these names (tests/unit/release-script.unit.test.ts runs scripts/release.sh directly).

Until then: the scripts run by their file paths; `pnpm release` and the two short names are not defined..
