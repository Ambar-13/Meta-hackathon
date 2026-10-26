# Request build/w1-golden-path-001

File: package.json (repository root)

Change wanted:

```diff
   "devDependencies": {
+    "@meet-first/contracts": "workspace:*",
+    "@meet-first/db": "workspace:*",
+    "@meet-first/parsers": "workspace:*",
+    "@meet-first/scrub": "workspace:*",
     "@secretlint/secretlint-rule-preset-recommend": "13.0.6",
```

Then one `pnpm install` on main, so pnpm-lock.yaml records the four links.

Why: scripts/golden-path.ts and scripts/golden-path/ import `@meet-first/contracts`, `@meet-first/db`, `@meet-first/parsers` and `@meet-first/scrub`. The root node_modules holds none of them, so Node and Vite cannot resolve them from the scripts folder. The unit tests R8.1-T1, R8.1-T2, D47-T1, R5.11-T1, A7-T1, R9.5-T1, golden-path-T1, golden-path-T2 and R2.5-T1 all fail to load without it.

Until then: no value is used in place of the link. For my own local runs only, I linked the four packages into the worktree's untracked node_modules/@meet-first folder; that link is not in the repository and is not part of this change.

Resolved at merge, 26 Oct: applied on main with the golden-path merge.
