Request build/w2-deletion-001. File: apps/worker/src/runner.ts. Change wanted (this replaces the spec's day-one request for `delete_person` and `purge_expired` with the one line the parent note names for slot 6):

```diff
 import { quizTasks } from "./quizzes/index.js";
+import { retentionTasks } from "./retention/index.js";
 
 // Every task the worker runs, one spread per feature folder, in slot order (seams S3).
 export const TASKS: TaskList = {
   ...cardTasks,
   ...quizTasks,
   ...meetingTasks,
   // slot 4: briefTasks from "./briefs/index.js", added by briefs through a request
   // slot 5: comicTasks from "./comics/index.js", added by comic through a request
-  // slot 6: retentionTasks from "./retention/index.js", added by deletion through a request
+  ...retentionTasks,
 };
```

Why: the worker must run `delete_person` and `purge_expired`. `retentionTasks` (apps/worker/src/retention/index.ts) holds both. `crontabForTasks` builds the hourly `purge_expired` line from this list, so no cron request is needed (CRONTAB in packages/contracts already has it). The retention tests register `retentionTasks`' jobs themselves and do not wait for this slot.

Until then: the worker task list has no retention entry, so the hourly purge and the account deletion do not run in the worker. My tests call `deletePersonTask` and `purgeExpiredTask` directly and need nothing from this file.
