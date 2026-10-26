Request check-wave-2-001. To: the integrator. From: the Wave 2 checker, run 1 on main 643f864 (2026-10-26 21:04 +08:00). File: scripts/check-wave-2.sh, the function `s23_forbidden_imports` (lines 228 to 236, added in 4d714f1). Kind: script defect, no builder clock.

Error: row 23 fails on a tree that holds none of the three forbidden things. The summary line is `23 forbidden-imports fail exit=1 0s` and the row's output file `docs/evidence/check-wave-2/23-forbidden-imports.txt` is empty, because the row never reaches its `echo`. The row runs under the script's own `set -euo pipefail`. grep exits 1 when it finds no file, and that is the pass case here. With pipefail, the pipeline `grep ... | wc -l | tr -d ' '` then returns 1, the assignment `mock=$(...)` returns 1, and `set -e` ends the row's process before it prints or compares the counts. The script stops at its first failing row, so rows 24 (invariant 21, no token in a log) and 25 (the servers stop) did not run.

Reproduction, read only, on 643f864:

- `grep -rln --exclude-dir=node_modules --exclude-dir=dist --exclude="*.md" "mock-api" apps packages` prints no file and exits 1.
- `grep -rln --exclude-dir=node_modules --exclude-dir=dist --exclude="*.md" "META_API_KEY" apps/web apps/api` prints no file and exits 1.
- The msw grep prints one file, `apps/web/src/testing/mock-server.ts`, which is the allowed folder, and exits 0; the `grep -v '^apps/web/src/testing/'` stage after it selects nothing and exits 1.
- `bash -c 'set -euo pipefail; mock=$(grep -rln ... "mock-api" apps packages 2>/dev/null | wc -l | tr -d " "); echo reached'` prints nothing and exits 1. The same line under `set -eu` prints `mock=0` and exits 0.

Change wanted, the smallest diff:

```diff
 s23_forbidden_imports() {
   local mock key msw
+  # grep exits 1 when it finds nothing, which is the pass case here. The row runs in its own process, so this changes only this row.
+  set +o pipefail
   mock=$(grep -rln --exclude-dir=node_modules --exclude-dir=dist --exclude="*.md" "mock-api" apps packages 2>/dev/null | wc -l | tr -d ' ')
```

Row 24 already guards its greps with `|| true`. Adding `|| true` after each of the three greps, and after the `grep -v` stage, is the same fix written in that style.

Why: as written, row 23 can never pass. A count of 0 means its grep found nothing and exited 1, which ends the row; a count above 0 fails the comparison. So scripts/check-wave-2.sh can never reach its last line, with or without Docker, and rows 24 and 25 never run.

Until then: every run of scripts/check-wave-2.sh on this tree ends with `check-wave-2: fail at 23`. The checker does not edit the script, does not run rows 23 to 25 by hand, and did not spend its second run on this, because the failure does not depend on timing.
