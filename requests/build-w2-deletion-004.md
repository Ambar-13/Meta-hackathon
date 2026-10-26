Request build/w2-deletion-004. File: specs/wave-2-deletion.md at /Users/ambar/Downloads/persona-hackathon/specs/wave-2-deletion.md (integrator decision). Change wanted: in section 5, W2-DEL-T2, change the check text from "reached by meeting_id or by comic_id in PERSON_TABLES" to:

```diff
-- `W2-DEL-T2 (invariant 16): every table with a meeting_id column is reached by meeting_id or by comic_id in PERSON_TABLES`.
+- `W2-DEL-T2 (invariant 16): every table with a meeting_id column is reached by meeting_id, by comic_id or by ledger_nulled in PERSON_TABLES`.
```

Why: the table `ledger` has a meeting_id column (0001, ON DELETE SET NULL), and section 4.1 gives it reach `ledger_nulled` (rows kept, ids go null, D69). T2 as written fails on `ledger` alone; every other table with a meeting_id column is reached by meeting_id or comic_id.

Until then: `ledger` is listed with reach `ledger_nulled` as section 4.1 gives it. T2 reports `ledger` as unreached and fails. No value of mine is used.
