Request build/w2-deletion-003. File: specs/wave-2-deletion.md in the planning folder (the spec is not my file; this is a decision for the integrator). Change wanted, option A (the one I built to): in section 5, W2-DEL-T3 and the expected counts of W2-DEL-T4, change `briefs: 2` to `briefs: 1`, and add to section 4.1 under the joint-table rule:

```diff
-Count statements (Kysely), by `reach`:
+A person's transaction sees only that person's brief row (0001 policy briefs_member, the private reading of wave-0-5), so `briefs` counts the person's own brief for each meeting: 1 in the seed. The other member's brief goes with the meeting through the cascade, and is not counted.
+
+Count statements (Kysely), by `reach`:
```

Option B, if the integrator wants the record to count both briefs: count the joint briefs in a separate meeting-context read before the person's transaction. That changes countPersonRows' signature from a transaction to a database, which section 4.1 does not allow, so it needs the spec changed as well.

Why: test W2-DEL-T3 (`countPersonRows` on the seed) expects `briefs: 2`, and W2-DEL-T4 expects the deletions record to equal that object. Under 0001 policy briefs_member, a person's transaction returns only the person's own brief, so the count is 1. The other rows of the seed match the expected object exactly.

Until then: `countPersonRows` counts `briefs` as the person's context can see it, which is 1 for person a. No value of mine is used. T3 and T4 fail on that one key and report it.
