Request build/w2-comic-003. File: apps/worker/src/runner.ts. Change wanted:

```diff
+import { comicTasks } from "./comics/index.js";
...
-  // slot 5: comicTasks from "./comics/index.js", added by comic through a request
+  ...comicTasks,
```

The import line goes after the quizTasks import on line 11. The `...comicTasks,` line replaces the slot 5 comment inside the task list, at that comment's indentation, in the same form as the slot 1 line `...cardTasks,`.

Why: the golden path step 14 needs Graphile to find the render_comic job, so the comic must be in the list the worker runs. Tests W2-COMIC-T7 to T11 and the golden-path comic test call the task directly from apps/worker/src/comics/index.ts and do not need this line.

Until then: the render_comic job is not in the runner's task list, so no comic job runs in a worker started from main. No value is used.
