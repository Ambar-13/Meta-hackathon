Request build/w2-briefs-001. File: apps/worker/src/runner.ts. Change wanted:

```diff
+import { briefTasks } from "./briefs/index.js";
-// slot 4: briefTasks from "./briefs/index.js", added by briefs through a request
+...briefTasks,
```

The import line goes first in the file's import block. The `...briefTasks,` line replaces the slot 4 comment inside the task list, at that comment's indentation, in the same form as the slot 1 line `...cardTasks,`.

Why: the write_briefs job has to be in the worker's task list for the golden path (step 13 reads the briefs it writes) and for scripts/check-wave-2.sh. My tests do not need it: they call writeBriefsTask and briefTasks directly.

Until then: the write_briefs job is not registered in a running worker, so no brief is written by the worker. No value is used.
