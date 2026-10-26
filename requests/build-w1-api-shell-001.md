Request build-w1-api-shell-001. File: packages/db/migrations/<next free number>_api_enqueue_grants.sql (new; the database builder takes the number from packages/db/migrations/ranges.txt in merge order). Change wanted:

```diff
+-- package: db
+-- Lets the api role put jobs on the Graphile queue, because routes enqueue build_card, answer_quiz, judge_quiz, check_question, meeting_step and delete_person.
+GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA graphile_worker TO app_api;
+GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA graphile_worker TO app_api;
```

Why: test D69-T1 in apps/api/src/sessions/sessions.integration.test.ts enqueues delete_person through makeApiEnqueue as app_api. Migration 0001 grants app_api only USAGE on the graphile_worker schema and EXECUTE on its functions, and no input says whether graphile_worker.add_job writes its tables with its owner's rights. If it does, decline this request. Until then: the enqueue call is in the code, and D69-T1 is reported failing with the permission error, not skipped.

Resolved, 26 Oct: the database migrate grants app_api SELECT and INSERT on the three job tables add_job touches, with row security policies, and read on Graphile's migrations table (commits 136d2cd, 2df76d2).
