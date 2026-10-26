# Request build/w2-deploy-and-docs-003: lint configuration

Request build/w2-deploy-and-docs-003. File: eslint.config.js.

Change wanted:

```diff
   parserOptions: { projectService: { allowDefaultProject: [
-    "scripts/checks/*.ts", "vitest.workspace.ts"
+    "scripts/checks/*.ts", "vitest.workspace.ts",
+    "scripts/path-ownership.ts", "scripts/constants-name-rows.ts",
+    "tests/unit/*.ts"
   ], defaultProject: "tsconfig.base.json", ... } } },
```

Why: `pnpm lint` reports a parsing error for each of the six new files, because no tsconfig includes scripts/path-ownership.ts, scripts/constants-name-rows.ts or tests/unit/*.ts. With this list added, the six files lint clean (checked with a scratch copy of the config outside the repository, with the same list).

Until then: `pnpm lint` fails on the six files. Their code and tests are written to the rules (no `any`, functions under 60 lines, export comments, vitest rules)..
