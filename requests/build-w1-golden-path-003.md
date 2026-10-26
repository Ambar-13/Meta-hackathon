# Request build/w1-golden-path-003

File: vitest.workspace.ts

Change wanted:

```diff
     test: {
       name: kind,
-      include: [`{apps,packages}/*/src/**/*.${kind}.test.{ts,tsx}`, `tests/${kind}/**/*.test.ts`],
+      include: [`{apps,packages}/*/src/**/*.${kind}.test.{ts,tsx}`, `scripts/**/*.${kind}.test.ts`, `tests/${kind}/**/*.test.ts`],
```

Why: the golden path's unit tests live in scripts/golden-path/ (the spec's section 8). The workspace includes only apps, packages and tests, so `pnpm test:unit scripts/golden-path` finds no file and runs nothing. With this line, the unit project runs the four files scripts/golden-path/*.unit.test.ts. The tests that need it are golden-path-T1 and golden-path-T2 (flags), R8.1-T1, R8.1-T2, D47-T1, R5.11-T1 (event stream reader), A7-T1 and R9.5-T1 (person client), and R2.5-T1 (database reads).

Until then: those tests pass when run through a scratch Vitest config that names the same folder (9 of 9 pass in my worktree). The workspace command `pnpm test:unit scripts/golden-path` finds no file until this change lands.
