Request build/w2-deletion-002. File: apps/worker/README.md. Change wanted (two sentences of the existing README; the five headings and the Mermaid block stay as they are):

```diff
-`src/testing/` holds the test runner, the fake clock, the recorded reply helpers, the fixture cases and the golden path rules.
+`src/retention/` holds the account deletion (`delete-person-job.ts`), the hourly purge (`purge-expired-job.ts`) and the table list that the deletion counts rows with (`table-list.ts`). `src/testing/` holds the test runner, the fake clock, the recorded reply helpers, the fixture cases and the golden path rules.
```

```diff
-Not built yet: the brief, comic and retention task lists; each lands with its Wave 2 builder.
+Not built yet: the brief and comic task lists; each lands with its Wave 2 builder.
```

Why: the README says the retention task list is not built, and after request 001 it is. No test reads the README; the line is wrong once request 001 merges.

Until then: the README says retention is not built. No code depends on it.
