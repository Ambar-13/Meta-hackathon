# Request build/w1-meeting-engine-002

File: `apps/worker/src/runner.ts` (owner: dossier, Wave 1)

Change wanted:

```diff
+import { meetingTasks } from "./meetings/index.js";
...
-  // slot 3: meetingTasks from "./meetings/index.js", added by meeting-engine through a request
+  ...meetingTasks,
```

The spread goes inside the merged task list, next to the other task maps (seams S3). The spread form follows the dossier's `taskList` object; the dossier builder may write the line in its own form if the merged list differs.

Why: the three meeting jobs (`meeting_step`, `sweep_stalled`, `check_question`) reach the worker only through slot 3 (seams S3). Test: the worker boots with the three meeting jobs and the `sweep_stalled` cron. That check is the worker boot test in the dossier folder.

Until then: the meeting tests call the three tasks directly through `makeMeetingTestContext` and `drainJobs` (spec section 4.15). No value is used.

Resolved at merge, 26 Oct: applied on main with the meeting-engine merge.
